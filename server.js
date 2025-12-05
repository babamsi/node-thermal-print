const express = require('express');
const cors = require('cors');
const { SerialPort } = require('serialport');
const {
  ThermalPrinter,
  PrinterTypes,
  CharacterSet,
  BreakLine,
} = require('node-thermal-printer');

const app = express();
app.use(cors());
app.use(express.json());

// FORCE printer to work with Express
const PRINTER_INTERFACE = 'COM01'; // Use EXACTLY this format for Windows
const PRINTER_BAUD_RATE = 9600; // Verify this matches your printer's spec

// Nuclear option: Direct serial port control
async function forcePrint(buffer) {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path: PRINTER_INTERFACE,
      baudRate: PRINTER_BAUD_RATE,
      autoOpen: false
    });

    port.open(async (err) => {
      if (err) return reject(`Port open error: ${err.message}`);
      
      port.write(buffer, (err) => {
        if (err) return reject(`Write error: ${err.message}`);
        
        // CRITICAL: Wait until all data is physically transmitted
        port.drain(() => {
          port.close((err) => {
            if (err) console.error(`Close error: ${err.message}`);
            resolve();
          });
        });
      });
    });
  });
}

function parsePaymentMethod(paymentMethod) {
  let cash = 0;
  let mpesa = 0;
  let card = 0;
  let isSplit = false;

  if (!paymentMethod) {
    return { cash, mpesa, card, isSplit };
  }

  // If it's a string, try to parse it
  if (typeof paymentMethod === 'string') {
    if (paymentMethod.startsWith('{')) {
      try {
        paymentMethod = JSON.parse(paymentMethod);
      } catch {
        // If parsing fails, return empty
        return { cash: 0, mpesa: 0, card: 0, isSplit: false };
      }
    } else {
      // Simple string payment method - return empty, caller will use order total
      return { cash: 0, mpesa: 0, card: 0, isSplit: false };
    }
  }

  // If it's an object
  if (typeof paymentMethod === 'object' && paymentMethod !== null) {
    cash = Number(paymentMethod.cash) || 0;
    mpesa = Number(paymentMethod.mpesa) || 0;
    card = Number(paymentMethod.card) || 0;
    
    // Check if it's a split payment (multiple methods with amounts > 0)
    const methodsWithAmount = [cash > 0, mpesa > 0, card > 0].filter(Boolean).length;
    isSplit = methodsWithAmount > 1;
  }

  return { cash, mpesa, card, isSplit };
}


app.post('/printday', (req, res) => {

  try {
    const { orders, dateRange, totals, restaurant, address, phone } = req.body;

    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ success: false, error: 'No orders provided' });
    }

    // Calculate payment method totals
    let totalCash = 0;
    let totalMpesa = 0;
    let totalCard = 0;

    // Calculate order type totals
    let dineInTotal = 0;
    let takeawayTotal = 0;
    let homeDeliveryTotal = 0;
    const orderTypeCounts = {};

    // Process all orders
    orders.forEach((order) => {
      const orderTotal = order.total_amount || 0;
      const paymentInfo = parsePaymentMethod(order.payment_method);
      
      if (paymentInfo.isSplit) {
        // Split payment - use the parsed amounts directly
        totalCash += paymentInfo.cash;
        totalMpesa += paymentInfo.mpesa;
        totalCard += paymentInfo.card;
      } else if (paymentInfo.cash > 0 || paymentInfo.mpesa > 0 || paymentInfo.card > 0) {
        // Single payment method from object (only one has value)
        totalCash += paymentInfo.cash;
        totalMpesa += paymentInfo.mpesa;
        totalCard += paymentInfo.card;
      } else {
        // Single payment method stored as string - infer from string
        const pmStr = typeof order.payment_method === 'string' 
          ? order.payment_method.toLowerCase() 
          : '';
        
        if (pmStr.includes('cash') || pmStr === 'cash') {
          totalCash += orderTotal;
        } else if (pmStr.includes('mpesa') || pmStr === 'mpesa') {
          totalMpesa += orderTotal;
        } else if (pmStr.includes('card') || pmStr === 'card') {
          totalCard += orderTotal;
        } else {
          // Default to cash if unknown
          totalCash += orderTotal;
        }
      }

      // Calculate by order type
      const orderType = order.order_type || 'dine-in';
      if (orderType === 'dine-in') {
        dineInTotal += orderTotal;
        orderTypeCounts['dine-in'] = (orderTypeCounts['dine-in'] || 0) + 1;
      } else if (orderType === 'takeaway' || orderType === 'take-away') {
        takeawayTotal += orderTotal;
        orderTypeCounts['takeaway'] = (orderTypeCounts['takeaway'] || 0) + 1;
      } else if (orderType === 'home_delivery' || orderType === 'home-delivery') {
        homeDeliveryTotal += orderTotal;
        orderTypeCounts['home_delivery'] = (orderTypeCounts['home_delivery'] || 0) + 1;
      }
    });

    // Create printer
    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: PRINTER_INTERFACE,
      options: { timeout: 30000 },
      width: 48,
      characterSet: CharacterSet.SLOVENIA,
      breakLine: BreakLine.WORD,
      removeSpecialCharacters: false,
      lineCharacter: '-',
    });

    // ============================================
    // MODERN RECEIPT DESIGN
    // ============================================

    // Top spacing
    printer.println('');

    // Restaurant Header - Small, slightly bold
    printer.alignCenter();
    printer.setTextSize(1, 1);
    printer.bold(true);
    printer.println(restaurant || 'RESTAURANT NAME');
    printer.bold(false);
    printer.println('');

    // Address & Contact - Small text
    if (address) {
      printer.println(address);
    } else {
      printer.println('123 Main Street, City');
    }
    if (phone) {
      printer.println(`Tel: ${phone}`);
    } else {
      printer.println('Phone: (123) 456-7890');
    }
    printer.println('');

    // Decorative line
    printer.drawLine();
    printer.println('');

    // Report Information Section
    printer.alignLeft();
    printer.setTextSize(1, 1);
    printer.println('DAY SALES REPORT');
    printer.println('');

    // Date range info
    printer.leftRight('From:', dateRange?.from || 'N/A');
    printer.leftRight('To:', dateRange?.to || 'N/A');
    printer.leftRight('Report Date:', new Date().toLocaleDateString());
    printer.leftRight('Report Time:', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    
    printer.println('');
    printer.drawLine();
    printer.println('');

    // ============================================
    // SUMMARY SECTION
    // ============================================
    printer.alignCenter();
    printer.bold(true);
    printer.println('SUMMARY');
    printer.bold(false);
    printer.alignLeft();
    printer.println('');

    printer.leftRight('Total Orders:', `${totals?.orderCount || orders.length}`);
    printer.leftRight('Total Revenue:', `Ksh ${(totals?.totalRevenue || 0).toFixed(2)}`);
    printer.leftRight('Subtotal:', `Ksh ${(totals?.totalSubtotal || 0).toFixed(2)}`);
    printer.leftRight('Tax:', `Ksh ${(totals?.totalTax || 0).toFixed(2)}`);
    if (totals?.totalDiscount && totals.totalDiscount > 0) {
      printer.leftRight('Total Discounts:', `Ksh ${totals.totalDiscount.toFixed(2)}`);
    }

    printer.println('');
    printer.drawLine();
    printer.println('');

    // ============================================
    // PAYMENT METHOD TOTALS
    // ============================================
    printer.alignCenter();
    printer.bold(true);
    printer.println('PAYMENT METHODS');
    printer.bold(false);
    printer.alignLeft();
    printer.println('');

    printer.leftRight('Cash Total:', `Ksh ${totalCash.toFixed(2)}`);
    printer.leftRight('Mpesa Total:', `Ksh ${totalMpesa.toFixed(2)}`);
    if (totalCard > 0) {
      printer.leftRight('Card Total:', `Ksh ${totalCard.toFixed(2)}`);
    }

    printer.println('');
    printer.drawLine();
    printer.println('');

    // ============================================
    // ORDER TYPE BREAKDOWN
    // ============================================
    printer.alignCenter();
    printer.bold(true);
    printer.println('ORDER TYPE BREAKDOWN');
    printer.bold(false);
    printer.alignLeft();
    printer.println('');

    printer.leftRight('Dine-in Total:', `Ksh ${dineInTotal.toFixed(2)}`);
    if (orderTypeCounts['dine-in']) {
      printer.println(`  (${orderTypeCounts['dine-in']} orders)`);
    }

    printer.leftRight('Takeaway Total:', `Ksh ${takeawayTotal.toFixed(2)}`);
    if (orderTypeCounts['takeaway']) {
      printer.println(`  (${orderTypeCounts['takeaway']} orders)`);
    }

    printer.leftRight('Home Delivery Total:', `Ksh ${homeDeliveryTotal.toFixed(2)}`);
    if (orderTypeCounts['home_delivery']) {
      printer.println(`  (${orderTypeCounts['home_delivery']} orders)`);
    }

    printer.println('');
    printer.drawLine();
    printer.println('');

    // ============================================
    // ALL ITEMS DETAIL
    // ============================================
    printer.alignCenter();
    printer.bold(true);
    printer.println('ALL ITEMS SOLD');
    printer.bold(false);
    printer.alignLeft();
    printer.println('');

    // Collect all items with quantities
    const itemMap = {};

    orders.forEach((order) => {
      if (order.items && Array.isArray(order.items)) {
        order.items.forEach((item) => {
          const itemKey = `${item.menu_item_name || item.name}_${item.portion_size || ''}`;
          if (!itemMap[itemKey]) {
            itemMap[itemKey] = {
              name: item.menu_item_name || item.name,
              quantity: 0,
              totalPrice: 0,
              portionSize: item.portion_size,
            };
          }
          itemMap[itemKey].quantity += item.quantity || 1;
          itemMap[itemKey].totalPrice += item.total_price || (item.unit_price || 0) * (item.quantity || 1);
        });
      }
    });

    // Print items in table format
    if (Object.keys(itemMap).length > 0) {
      // Items Table Header
      printer.tableCustom([
        { text: 'Item', align: 'LEFT', width: 0.5 },
        { text: 'Qty', align: 'CENTER', width: 0.15 },
        { text: 'Total', align: 'RIGHT', width: 0.35 }
      ]);
      printer.drawLine();
      printer.println('');

      // Sort items by total price (descending)
      const sortedItems = Object.values(itemMap).sort((a, b) => b.totalPrice - a.totalPrice);

      sortedItems.forEach((item) => {
        const itemName = `${item.name}${item.portionSize ? ` (${item.portionSize})` : ''}`;
        
        // Item name (can wrap)
        printer.alignLeft();
        printer.println(itemName);

        // Price details
        printer.tableCustom([
          { text: '', align: 'LEFT', width: 0.5 },
          { text: `x${item.quantity}`, align: 'CENTER', width: 0.15 },
          { text: `Ksh ${item.totalPrice.toFixed(2)}`, align: 'RIGHT', width: 0.35 }
        ]);

        printer.println('');
      });

      printer.drawLine();
      printer.println('');
    }

    // ============================================
    // FOOTER SECTION
    // ============================================
    printer.alignCenter();
    printer.println('');
    printer.drawLine();
    printer.println('');
    printer.println('=== END OF REPORT ===');
    printer.println('');
    printer.println('Thank you!');
    printer.println('');

    // Bottom spacing
    printer.println('');
    printer.println('');

    // Cut and beep
    printer.cut();
    printer.beep();

    // Get buffer and print
    const buffer = printer.getBuffer();

    // Check if printer is connected
    const isConnected = await printer.isPrinterConnected();
    if (!isConnected) {
      return res.status(500).json({ success: false, error: 'Printer not connected' });
    }

    // Execute print
    await printer.execute();

    return res.json({ success: true, message: 'Day sales report printed successfully' });
  } catch (error) {
    console.error('Print day sales error:', error);
    return res.status(500).json({ 
      success: false, 
      error: `PRINT FAILED: ${error.message || error}` 
    });
  }
  
})

app.get('/', (req,res) => {
  res.send("its working...")
})



app.post('/print-receipt', async (req, res) => {
  try {
    const { order, items, totals, restaurant, table, date, time, receiptId, address, phone } = req.body;

    // 1. Create printer commands (same config as /force-test)
    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: PRINTER_INTERFACE,
      options: { timeout: 30000 },
      width: 48,
      characterSet: CharacterSet.SLOVENIA
    });

    // ============================================
    // MODERN RECEIPT DESIGN
    // ============================================

    // Top spacing
    printer.println('');

    // Restaurant Header - Small, slightly bold
    printer.alignCenter();
    printer.setTextSize(1, 1);
    printer.bold(true);
    printer.println(restaurant || 'RESTAURANT NAME');
    printer.bold(false);
    printer.println('');

    // Address & Contact - Small text
    if (address) {
      printer.println(address);
    } else {
      printer.println('123 Main Street, City');
    }
    if (phone) {
      printer.println(`Tel: ${phone}`);
    } else {
      printer.println('Phone: (123) 456-7890');
    }
    printer.println('');

    // Decorative line
    printer.drawLine();
    printer.println('');

    // Order Information Section - Clean Layout
    printer.alignLeft();
    printer.setTextSize(1, 1);
    printer.println('ORDER DETAILS');
    printer.println('');

    // Order info in two columns - Short order ID
    const orderNum = receiptId ? receiptId.slice(-6) : (order?.id ? order.id.slice(-6) : 'N/A');
    const tableNum =  table === 'Take Away' ? (order?.order_type || 'Take Away') : (table || order?.table_number || 'N/A');
    const orderDate = date || new Date().toLocaleDateString();
    const orderTime = time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    printer.leftRight('Order #:', orderNum);
    printer.leftRight('Table:', tableNum);

// Add home delivery details if available
if (req.body.homeDelivery) {
  const { address: deliveryAddress, name: deliveryName, phone: deliveryPhone } = req.body.homeDelivery;
  
  if (deliveryAddress) {
    printer.leftRight('Address:', deliveryAddress);
  }
  if (deliveryName) {
    printer.leftRight('Name:', deliveryName);
  }
  if (deliveryPhone) {
    printer.leftRight('Phone:', deliveryPhone);
  }
}
    
    printer.leftRight('Date:', orderDate);
    printer.leftRight('Time:', orderTime);
    
    printer.println('');
    printer.drawLine();
    printer.println('');

    // Items Section - Modern Table Format
    if (items && items.length > 0) {
      printer.println('ITEMS');
      printer.println('');

      // Items Table Header
      printer.tableCustom([
        { text: 'Item', align: 'LEFT', width: 0.5 },
        { text: 'Qty', align: 'CENTER', width: 0.15 },
        { text: 'Total', align: 'RIGHT', width: 0.35 }
      ]);

      printer.drawLine();
      printer.println('');

      // Items List
      items.forEach((item) => {
        const itemName = `${item.menu_item_name}${item.portion_size ? ` (${item.portion_size})` : ''}`;
        const quantity = item.quantity || 1;
        const unitPrice = item.unit_price || 0;
        const itemTotal = item.total_price || (unitPrice * quantity);

        // Item name (can wrap)
        printer.alignLeft();
        printer.println(itemName);

        // Customization notes if any
        if (item.customization_notes) {
          printer.println(`  └ ${item.customization_notes}`);
        }

        // Price details
        printer.tableCustom([
          { text: '', align: 'LEFT', width: 0.5 },
          { text: `x${quantity}`, align: 'CENTER', width: 0.15 },
          { text: `Ksh ${itemTotal.toFixed(2)}`, align: 'RIGHT', width: 0.35 }
        ]);

        // Show unit price if different from total
        if (quantity > 1) {
          printer.tableCustom([
            { text: `  @ Ksh ${unitPrice.toFixed(2)}`, align: 'LEFT', width: 0.5 },
            { text: '', align: 'CENTER', width: 0.15 },
            { text: '', align: 'RIGHT', width: 0.35 }
          ]);
        }

        printer.println('');
      });

      printer.drawLine();
      printer.println('');
    }

    // Totals Section - Prominent & Clear
    printer.alignRight();
    printer.println('');

    if (totals?.subtotal) {
      printer.println(`Subtotal:     Ksh ${totals.subtotal.toFixed(2)}`);
    }
    if (totals?.tax) {
      printer.println(`Tax (16%):    Ksh ${totals.tax.toFixed(2)}`);
    }
    if (totals?.discount && totals.discount > 0) {
      printer.println(`Discount:     Ksh ${totals.discount.toFixed(2)}`);
    }

    printer.drawLine();
    
    if (totals?.total) {
      printer.println(`TOTAL:        Ksh ${totals.total.toFixed(2)}`);
    }

    printer.drawLine();
    printer.println('');

    // Payment Method (if provided)
    if (req.body.paymentMethod) {
      printer.alignLeft();
      printer.println(`Payment: ${req.body.paymentMethod}`);
      if (req.body.paymentMethod === 'Cash' && req.body.cashReceived) {
        printer.println(`Received: Ksh ${req.body.cashReceived.toFixed(2)}`);
        if (req.body.change) {
          printer.println(`Change:  Ksh ${req.body.change.toFixed(2)}`);
        }
      }
      printer.println('');
    }

    // Footer Section - Modern & Professional
    printer.alignCenter();
    printer.println('');
    printer.drawLine();
    printer.println('');
    printer.println('Thank you for dining with us!');
    printer.println('');
    printer.println('We appreciate your business');
    printer.println('');

    // QR Code for receipt verification (if receiptId provided)
    if (receiptId || order?.id) {
      printer.println('');
      printer.printQR(receiptId || order.id);
      printer.println('');
      const shortReceiptId = receiptId ? receiptId.slice(-6) : (order?.id ? order.id.slice(-6) : '');
      printer.println(`Receipt ID: ${shortReceiptId}`);
      printer.println('');
    }

    // Bottom spacing
    printer.println('');
    printer.println('');

    // Cut and beep
    printer.cut();
    printer.beep();

    // 2. Get raw buffer
    const buffer = printer.getBuffer();
    
    // 3. Physically force the data to printer
    await forcePrint(buffer);
    
    res.json({ success: true, message: 'Modern receipt printed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: `FORCE PRINT FAILED: ${error.message || error}` });
  }
});

// Test print endpoint (GUARANTEED to work)
app.get('/force-test', async (req, res) => {
  try {
    // 1. Create printer commands
    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: PRINTER_INTERFACE,
      options: { timeout: 30000 },
      width: 48,
      characterSet: CharacterSet.PC437_USA
    });

    // Print receipt content
    printer.alignCenter();
    printer.setTextSize(1, 1);
    printer.bold(true);
    printer.println('Waraa biyo ii keen');
    printer.bold(false);
    printer.println('Bring some water nigga');
    printer.println('Tel: +254 705 043 383');
    
    printer.drawLine();

    // Header
    printer.alignLeft();
    printer.println(`Date: ${new Date().toLocaleString()}`);
    printer.println(`Invoice: SAMPLE-${Date.now()}`);
    printer.println('Cashier: Zubeir');
    
    printer.drawLine();

    // Items
    // printer.tableCustom([
    //   { text: 'Item', align: 'LEFT', width: 0.4 },
    //   { text: 'Qty', align: 'RIGHT', width: 0.2 },
    //   { text: 'Price', align: 'RIGHT', width: 0.2 },
    //   { text: 'Total', align: 'RIGHT', width: 0.2 }
    // ]);

    // printer.tableCustom([
    //   { text: 'Sample Item 1', align: 'LEFT', width: 0.4 },
    //   { text: '2', align: 'RIGHT', width: 0.2 },
    //   { text: '500', align: 'RIGHT', width: 0.2 },
    //   { text: '1,000', align: 'RIGHT', width: 0.2 }
    // ]);

    // printer.tableCustom([
    //   { text: 'Sample Item 2', align: 'LEFT', width: 0.4 },
    //   { text: '1', align: 'RIGHT', width: 0.2 },
    //   { text: '750', align: 'RIGHT', width: 0.2 },
    //   { text: '750', align: 'RIGHT', width: 0.2 }
    // ]);

    printer.drawLine();

    // Totals
    // printer.alignRight();
    // printer.println('Subtotal: KES 1,750.00');
    // printer.println('Discount: KES 0.00');
    // printer.bold(true);
    // printer.println('Total: KES 1,750.00');
    // printer.bold(false);

    // printer.drawLine();

    // Footer
    // printer.alignCenter();
    // printer.println('Thank you for shopping with us!');
    // printer.println('Please come again');

    // QR Code for receipt reference
    // printer.printQR(`RECEIPT-${Date.now()}`);
    
    printer.cut();
    printer.beep();

    // 2. Get raw buffer
    const buffer = printer.getBuffer();
    
    // 3. Physically force the data to printer
    await forcePrint(buffer);
    
    res.json({ success: true, message: 'Printer was FORCED to print' });
  } catch (error) {
    res.status(500).json({ error: `FORCE PRINT FAILED: ${error}` });
  }
});

// Receipt printing endpoint
app.post('/force-receipt', async (req, res) => {
  const printData = req.body;
  
  try {
    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: PRINTER_INTERFACE,
      options: { timeout: 30000 },
      width: 48,
      characterSet: CharacterSet.PC437_USA
    });

    // Build receipt (same as before)
    // Header
    printer.alignCenter();
    printer.setTextSize(1, 1);
    printer.bold(true);
    printer.println('AL QURASHI PERFUMES');
    printer.bold(false);
    printer.println('Eastleigh, Nairobi');
    printer.println('Tel: +254 xxx xxx');
    
    printer.drawLine();

    // Invoice Details
    printer.alignLeft();
    printer.println(`Date: ${printData.date}`);
    printer.println(`Invoice: ${printData.invoiceNumber}`);
    printer.println(`Cashier: ${printData.cashier}`);
    
    if (printData.customer) {
      printer.println(`Customer: ${printData.customer.name}`);
      printer.println(`Phone: ${printData.customer.phone}`);
    }
    
    printer.drawLine();

    // Items Header
    printer.tableCustom([
      { text: 'Item', align: 'LEFT', width: 0.4 },
      { text: 'Qty', align: 'RIGHT', width: 0.2 },
      { text: 'Price', align: 'RIGHT', width: 0.2 },
      { text: 'Total', align: 'RIGHT', width: 0.2 }
    ]);

    // Print each item
    printData.items.forEach(item => {
      printer.tableCustom([
        { text: item.name, align: 'LEFT', width: 0.4 },
        { text: item.quantity.toString(), align: 'RIGHT', width: 0.2 },
        { text: item.sellPrice.toFixed(2), align: 'RIGHT', width: 0.2 },
        { text: (item.quantity * item.sellPrice).toFixed(2), align: 'RIGHT', width: 0.2 }
      ]);
    });

    printer.drawLine();

    // Totals
    printer.alignRight();
    printer.println(`Subtotal: KES ${printData.subtotal.toFixed(2)}`);
    printer.println(`Discount: KES ${printData.discount.toFixed(2)}`);
    printer.bold(true);
    printer.println(`Total: KES ${printData.total.toFixed(2)}`);
    printer.bold(false);

    // Payment Details
    printer.println(`Payment Method: ${printData.paymentMethod}`);
    if (printData.paymentMethod === 'Cash' && printData.cashReceived) {
      printer.println(`Cash Received: KES ${printData.cashReceived.toFixed(2)}`);
      printer.println(`Change: KES ${printData.change?.toFixed(2) || '0.00'}`);
    }

    printer.drawLine();

    // Footer
    printer.alignCenter();
    printer.println('Thank you for shopping with us!');
    printer.println('Please come again');

    // QR Code with invoice number for verification
    printer.printQR(printData.invoiceNumber);
    
    printer.cut();
    printer.beep();

    // FORCE the print
    await forcePrint(printer.getBuffer());
    
    res.json({ success: true, message: 'Receipt printed by force' });
  } catch (error) {
    res.status(500).json({ error: `FORCE RECEIPT FAILED: ${error}` });
  }
});

const PORT = 4000;
app.listen(process.env.PORT || PORT, () => {
  console.log(`Nuclear printer server running on http://localhost:${PORT}`);
  console.log(`FORCE TEST ENDPOINT: GET http://localhost:${PORT}/force-test`);
});
