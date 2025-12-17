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
const PRINTER_INTERFACE = 'COM7'; // Use EXACTLY this format for Windows
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


// Updated printday server code with glovo and bolt separation
app.post('/printday', async (req, res) => {
  try {
    const { orders, dateRange, totals, restaurant, address, phone } = req.body;

    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ success: false, error: 'No orders provided' });
    }

    // Create printer commands
    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: PRINTER_INTERFACE,
      options: { timeout: 30000 },
      width: 48,
      characterSet: CharacterSet.SLOVENIA
    });

    // Calculate payment method totals
    let totalCash = 0;
    let totalMpesa = 0;
    let totalCard = 0;
    let totalGlovo = 0;
    let totalBolt = 0;

    // Calculate order type totals
    let dineInTotal = 0;
    let takeawayTotal = 0;
    let homeDeliveryTotal = 0;
    let glovoTotal = 0;
    let boltTotal = 0;
    const orderTypeCounts = {};

    // Process all orders
    orders.forEach((order) => {
      const orderTotal = order.total_amount || 0;
      const paymentInfo = parsePaymentMethod(order.payment_method);
      
      // Check if payment method is glovo or bolt first (these should be separate)
      const pmStr = typeof order.payment_method === 'string' 
        ? order.payment_method.toLowerCase() 
        : '';
      
      if (pmStr === 'glovo' || order.order_type === 'glovo') {
        // Glovo orders - separate from cash
        totalGlovo += orderTotal;
      } else if (pmStr === 'bolt' || order.order_type === 'bolt') {
        // Bolt orders - separate from cash
        totalBolt += orderTotal;
      } else if (paymentInfo.isSplit) {
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
        if (pmStr.includes('cash') || pmStr === 'cash') {
          totalCash += orderTotal;
        } else if (pmStr.includes('mpesa') || pmStr === 'mpesa') {
          totalMpesa += orderTotal;
        } else if (pmStr.includes('card') || pmStr === 'card') {
          totalCard += orderTotal;
        } else {
          // Default to cash if unknown (but not glovo/bolt)
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
      } else if (orderType === 'glovo') {
        glovoTotal += orderTotal;
        orderTypeCounts['glovo'] = (orderTypeCounts['glovo'] || 0) + 1;
      } else if (orderType === 'bolt') {
        boltTotal += orderTotal;
        orderTypeCounts['bolt'] = (orderTypeCounts['bolt'] || 0) + 1;
      }
    });

    // ============================================
    // MODERN RECEIPT DESIGN
    // ============================================

    // Top spacing
    printer.println('');

    // Restaurant Header - Small, slightly bold
    printer.alignCenter();
    printer.setTextSize(0, 0);
    printer.bold(true);
    printer.println('Orange Desserts');
    printer.bold(false);
    printer.println('');

    // Address & Contact - Small text
    if (address) {
      printer.println(address);
    } else {
      printer.println('South C Branch');
    }
    if (phone) {
      printer.println(`Tel: ${phone}`);
    } else {
      printer.println('Phone: 0723555569');
    }
    printer.println('');

    // Decorative line
    printer.drawLine();
    printer.println('');

    // Report Information Section
    printer.alignLeft();
    printer.setTextSize(0, 0);
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
    if (totalGlovo > 0) {
      printer.leftRight('Glovo Total:', `Ksh ${totalGlovo.toFixed(2)}`);
    }
    if (totalBolt > 0) {
      printer.leftRight('Bolt Total:', `Ksh ${totalBolt.toFixed(2)}`);
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

	printer.leftRight('Glovo Total:', `Ksh ${glovoTotal.toFixed(2)}`);
    if (orderTypeCounts['glovo']) {
      printer.println(`  (${orderTypeCounts['glovo']} orders)`);
    }

    printer.leftRight('Bolt Total:', `Ksh ${boltTotal.toFixed(2)}`);
    if (orderTypeCounts['bolt']) {
      printer.println(`  (${orderTypeCounts['bolt']} orders)`);
    }

    printer.println('');
    printer.drawLine();
    printer.println('');

    
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

   // 2. Get raw buffer
    const buffer = printer.getBuffer();
    
    // 3. Physically force the data to printer
    await forcePrint(buffer);
    
    res.json({ success: true, message: 'Modern receipt printed successfully' });
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
    const { order, items, totals, restaurant, table, date, time, receiptId, address, phone, homeDelivery } = req.body;

    // Create printer commands
    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: PRINTER_INTERFACE,
      options: { timeout: 30000 },
      width: 48,
      characterSet: CharacterSet.SLOVENIA
    });

    // ============================================
    // PARKLANDS BRANCH STYLE RECEIPT
    // ============================================



    // LOGO - Large bold text
    printer.alignCenter();
     await printer.printImage('./oranges.png');
    printer.bold(false);
    printer.setTextSize(0, 0);

    printer.println('');

    // Branch name in dashed box
    printer.alignCenter();
    const branchName = 'South C Branch';
    const branchLine = `-------- ${branchName} --------`;
    printer.println(branchLine);
    printer.println('');
    // Address and Phone in box
    printer.alignLeft();
    const addressText = 'Muhoho Ave - Nairobi';
    const phoneText = '0723555569';
    
    // Format address line
    printer.leftRight('Address', addressText);
    printer.leftRight('Phone', phoneText);
    
    // Close box


    // Order # - Right aligned with shortened ID
    const fullOrderId = receiptId || (order?.id || 'N/A');
    const orderNum = fullOrderId.length > 12 ? fullOrderId.slice(-10) : fullOrderId;
    printer.alignLeft();
    printer.leftRight('Order #', orderNum);
   


    // Table, Date, Time
    const tableNum =  table === 'Take Away' ? (order?.order_type || 'Take Away') : (table || order?.table_number || 'N/A');
    const orderDate = date || new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const orderTime = time || new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });

    printer.leftRight('Table #', tableNum);

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


    printer.leftRight('Date', orderDate);
    printer.leftRight('Time', orderTime);
    printer.leftRight('Status', order.status); 
    printer.println('');
    printer.drawLine('-');
    printer.println('');

    // Items List
    if (items && items.length > 0) {
      items.forEach((item) => {
        const quantity = item.quantity || 1;
        const itemName = item.menu_item_name || 'Item';
        const portionSize = item.portion_size ? ` - ${item.portion_size}` : '';
        const unitPrice = item.unit_price || 0;
        const itemTotal = item.total_price || (unitPrice * quantity);

        // Format: X2 - Item Name
        const itemLine = `X${quantity} - ${itemName}${portionSize}`;
       if (order?.order_type === "bolt" || order?.order_type === "glovo") {
          printer.println(itemLine)	
        } else {
          printer.leftRight(itemLine, itemTotal.toFixed(2));
	  	
        }

        

        // Customization notes indented with italic style
        if (item.customization_notes) {
          printer.alignLeft();
          printer.println(`     *${item.customization_notes}`);
        }

        printer.println('');
      });

      printer.drawLine('-');
      printer.println('');
    }

    // Totals Section
    printer.alignLeft();
    printer.setTextSize(0, 0);

     // Calculate breakdown
    let subtotalBeforeTax = 0;
    let vat = 0;
    let levy = 0;
    let finalTotal = 0;

    if (order?.order_type === "bolt" || order?.order_type === "glovo") {
		    printer.println('');


    // THANK YOU Section
    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println('THANK YOU!');
    printer.bold(false);
    printer.setTextSize(0, 0);
    printer.println('Enjoy your Orange Dessert');
    printer.println('');
    printer.println('');
    printer.println('');

    // Powered by MAAMUL
    printer.alignCenter();
    printer.println('- POWERED BY MAAMUL -');

    printer.setTextSize(0,0)
    printer.println('maamul.com')


} else {

    if (totals?.total) {
      // Total includes 18% (16% VAT + 2% Levy)
      // So if total = X, then subtotal before tax = X / 1.18
      finalTotal = totals.total;
      subtotalBeforeTax = finalTotal / 1.18;
      vat = subtotalBeforeTax * 0.16; // 16% VAT
      levy = subtotalBeforeTax * 0.02; // 2% Levy
    }
    // Display subtotal before tax
    const subtotalLabel = 'Subtotal (before Tax)';
    const subtotalValue = `KSH ${subtotalBeforeTax.toFixed(2)}`;
    printer.leftRight(subtotalLabel, subtotalValue);

    // Display VAT 16%
    const vatLabel = 'VAT (16%)';
    const vatValue = `KSH ${vat.toFixed(2)}`;
    printer.leftRight(vatLabel, vatValue);

    // Display Levy 2%
    const levyLabel = 'Levy (2%)';
    const levyValue = `KSH ${levy.toFixed(2)}`;
    printer.leftRight(levyLabel, levyValue);

    if (totals?.discount && totals.discount > 0) {
      const discountLabel = 'Discount';
      const discountValue = `KSH ${totals.discount.toFixed(2)}`;
      printer.bold();
      printer.leftRight(discountLabel, discountValue);
      printer.bold(false);
    }
 printer.println('');

    // Display Total (bold)
    const totalLabel = 'Total';
    const totalValue = `KSH ${finalTotal.toFixed(2)}`;
    printer.bold(true);
    printer.leftRight(totalLabel, totalValue);
    printer.bold(false);

    printer.println('');


    printer.bold(true);
    printer.alignCenter();
	
    printer.println('Till Number: 4983042');
    printer.bold(false);

  

    printer.println('');


    // THANK YOU Section
    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println('THANK YOU!');
    printer.bold(false);
    printer.setTextSize(0, 0);
    printer.println('Enjoy your Orange Dessert');
    printer.println('');
    printer.println('');
    printer.println('');

    // Powered by MAAMUL
    printer.alignCenter();
    printer.println('- POWERED BY MAAMUL -');

    printer.setTextSize(0,0)
    printer.println('maamul.com')

}
    // Cut and beep
    printer.cut();
    printer.beep();

    // Get buffer and print
    const buffer = printer.getBuffer();
    await forcePrint(buffer);
    
    res.json({ success: true, message: 'Receipt printed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: `FORCE PRINT FAILED: ${error.message || error}` });
  }
});


app.post('/forkitchenpr1', async (req, res) => {
  try {
    const { order, items, totals, restaurant, table, date, time, receiptId, address, phone, isUpdate, previousItems, newItems } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'No items provided for Printer 1' });
    }

    const hasPreviousItems = isUpdate && previousItems && Array.isArray(previousItems) && previousItems.length > 0;
    const hasNewItems = isUpdate && newItems && Array.isArray(newItems) && newItems.length > 0;

    if (isUpdate) {
      console.log(`[PRINTER 1] Printing order update - ${previousItems?.length || 0} previous items, ${newItems?.length || 0} new items`);
    } else {
      console.log(`[PRINTER 1] Printing ${items.length} items to Serial Printer (COM7)`);
    }

    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: PRINTER_INTERFACE, // COM7
      options: { timeout: 30000 },
      width: 48,
      characterSet: CharacterSet.SLOVENIA
    });

    // Header
    printer.setTextSize(0, 0);
    printer.println('');

    // Branch name
    printer.alignCenter();
    const branchName = 'South C Branch';
    const branchLine = `-------- ${branchName} --------`;
    printer.println(branchLine);
    printer.println('');

    // Order #, Table, Date, Time
    printer.alignLeft();
    const fullOrderId = receiptId || (order?.id || 'N/A');
    const orderNum = fullOrderId.length > 12 ? fullOrderId.slice(-10) : fullOrderId;
    printer.setTextSize(1,1);
    printer.leftRight('Order #', orderNum);
    printer.setTextSize(0, 0);

    const tableNum = table || order?.table_number || 'N/A';
    const orderDate = date || new Date().toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
    const orderTime = time || new Date().toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      second: '2-digit', 
      hour12: true 
    });

    printer.leftRight('Table #', tableNum);
    printer.leftRight('Date', orderDate);
    printer.leftRight('Time', orderTime);
    
    // Show update indicator if this is an order update
    if (isUpdate) {
      printer.println('');
      printer.alignCenter();
      printer.bold(true);
      printer.println('*** ORDER UPDATE ***');
      printer.bold(false);
      printer.alignLeft();
    }
    
    printer.println('');
    printer.drawLine('-');
    printer.println('');

    // Previous Items (if this is an update)
    if (hasPreviousItems) {
      printer.alignLeft();
      printer.println('PREVIOUS ITEMS:');
      printer.println('');
      
      previousItems.forEach((item) => {
        const quantity = item.quantity || 1;
        const itemName = item.menu_item_name || 'Item';
        const portionSize = item.portion_size ? ` - ${item.portion_size}` : '';
        const itemLine = `X${quantity} - ${itemName}${portionSize}`;
        printer.println(itemLine);

        // Customization notes
        if (item.customization_notes) {
          printer.alignLeft();
          printer.println(`     *${item.customization_notes}`);
        }
        printer.println('');
      });
      
      printer.drawLine('-');
      printer.println('');
    }

    // New/Replaced Items
    if (hasNewItems) {
      printer.alignLeft();
      printer.bold(true);
      // Use different label based on whether it's a replacement or addition
      const isReplacement = newItems.length === 1 && hasPreviousItems;
      printer.println(isReplacement ? 'REPLACED ITEM:' : 'NEW ITEMS:');
      printer.bold(false);
      printer.println('');
      
      newItems.forEach((item) => {
        const quantity = item.quantity || 1;
        const itemName = item.menu_item_name || 'Item';
        const portionSize = item.portion_size ? ` - ${item.portion_size}` : '';
        const itemLine = `X${quantity} - ${itemName}${portionSize}`;
        
        // Invert text for replaced items to make them stand out
        if (isReplacement) {
          printer.invert(true);
          printer.println(itemLine);
          printer.invert(false);
          
          // Customization notes for replaced item (also inverted)
          if (item.customization_notes) {
            printer.invert(true);
            printer.alignLeft();
            printer.println(`     *${item.customization_notes}`);
            printer.invert(false);
          }
        } else {
          printer.println(itemLine);
          
          // Customization notes
          if (item.customization_notes) {
            printer.alignLeft();
            printer.println(`     *${item.customization_notes}`);
          }
        }
        printer.println('');
      });
    } else {
      // Regular items list (for new orders)
      items.forEach((item) => {
        const quantity = item.quantity || 1;
        const itemName = item.menu_item_name || 'Item';
        const portionSize = item.portion_size ? ` - ${item.portion_size}` : '';
        const itemLine = `X${quantity} - ${itemName}${portionSize}`;
        printer.println(itemLine);

        // Customization notes
        if (item.customization_notes) {
          printer.alignLeft();
          printer.println(`     *${item.customization_notes}`);
        }
        printer.println('');
      });
    }

    printer.drawLine('-');
    printer.println('');

    // Cut and beep
    printer.cut();
    printer.beep();

    // Get buffer and print using serial port
    const buffer = printer.getBuffer();
    await forcePrint(buffer);

    console.log('[PRINTER 1] Print completed successfully');
    res.json({ success: true, message: 'Printed to Serial Printer (COM7)', printer: 'Printer 1' });

  } catch (error) {
    console.error('[PRINTER 1] Print error:', error);
    res.status(500).json({ 
      success: false, 
      error: `PRINTER 1 FAILED: ${error.message || error}`,
      printer: 'Printer 1'
    });
  }
});

// ============================================
// PRINTER 2: Network Printer 1 (192.168.0.1)
// Categories: Cold Coffee, Gelato
// ============================================
app.post('/forkitchenpr2', async (req, res) => {
  try {
    const { order, items, totals, restaurant, table, date, time, receiptId, address, phone, isUpdate, previousItems, newItems } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'No items provided for Printer 2' });
    }

    const hasPreviousItems = isUpdate && previousItems && Array.isArray(previousItems) && previousItems.length > 0;
    const hasNewItems = isUpdate && newItems && Array.isArray(newItems) && newItems.length > 0;

    if (isUpdate) {
      console.log(`[PRINTER 2] Printing order update - ${previousItems?.length || 0} previous items, ${newItems?.length || 0} new items`);
    } else {
      console.log(`[PRINTER 2] Printing ${items.length} items to Network Printer 1 (192.168.0.1)`);
    }

    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: 'tcp://192.168.0.1',
      options: { timeout: 30000 },
      width: 48,
      characterSet: CharacterSet.SLOVENIA
    });

    // Check if printer is connected (optional for network printers)
    try {
      const isConnected = await printer.isPrinterConnected();
      if (!isConnected) {
        console.warn('[PRINTER 2] Printer may not be connected at 192.168.0.1');
      }
    } catch (checkError) {
      console.warn('[PRINTER 2] Could not check connection:', checkError.message);
      // Continue anyway
    }

    // Header
    printer.setTextSize(0, 0);
    printer.println('');

    // Branch name
    printer.alignCenter();
    const branchName = 'South C Branch';
    const branchLine = `-------- ${branchName} --------`;
    printer.println(branchLine);
    printer.println('');

    // Order #, Table, Date, Time
    printer.alignLeft();
    const fullOrderId = receiptId || (order?.id || 'N/A');
    const orderNum = fullOrderId.length > 12 ? fullOrderId.slice(-10) : fullOrderId;
    printer.setTextSize(1, 1);
    printer.leftRight('Order #', orderNum);
    printer.setTextSize(0, 0);

    const tableNum = table || order?.table_number || 'N/A';
    const orderDate = date || new Date().toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
    const orderTime = time || new Date().toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      second: '2-digit', 
      hour12: true 
    });

    printer.leftRight('Table #', tableNum);
    printer.leftRight('Date', orderDate);
    printer.leftRight('Time', orderTime);
    
    // Show update indicator if this is an order update
    if (isUpdate) {
      printer.println('');
      printer.alignCenter();
      printer.bold(true);
      printer.println('*** ORDER UPDATE ***');
      printer.bold(false);
      printer.alignLeft();
    }
    
    printer.println('');
    printer.drawLine('-');
    printer.println('');

    // Previous Items (if this is an update)
    if (hasPreviousItems) {
      printer.alignLeft();
      printer.println('PREVIOUS ITEMS:');
      printer.println('');
      
      previousItems.forEach((item) => {
        const quantity = item.quantity || 1;
        const itemName = item.menu_item_name || 'Item';
        const portionSize = item.portion_size ? ` - ${item.portion_size}` : '';
        const itemLine = `X${quantity} - ${itemName}${portionSize}`;
        printer.println(itemLine);

        // Customization notes
        if (item.customization_notes) {
          printer.alignLeft();
          printer.println(`     *${item.customization_notes}`);
        }
        printer.println('');
      });
      
      printer.drawLine('-');
      printer.println('');
    }

    // New/Replaced Items
    if (hasNewItems) {
      printer.alignLeft();
      printer.bold(true);
      // Use different label based on whether it's a replacement or addition
      const isReplacement = newItems.length === 1 && hasPreviousItems;
      printer.println(isReplacement ? 'REPLACED ITEM:' : 'NEW ITEMS:');
      printer.bold(false);
      printer.println('');
      
      newItems.forEach((item) => {
        const quantity = item.quantity || 1;
        const itemName = item.menu_item_name || 'Item';
        const portionSize = item.portion_size ? ` - ${item.portion_size}` : '';
        const itemLine = `X${quantity} - ${itemName}${portionSize}`;
        
        // Invert text for replaced items to make them stand out
        if (isReplacement) {
          printer.invert(true);
          printer.println(itemLine);
          printer.invert(false);
          
          // Customization notes for replaced item (also inverted)
          if (item.customization_notes) {
            printer.invert(true);
            printer.alignLeft();
            printer.println(`     *${item.customization_notes}`);
            printer.invert(false);
          }
        } else {
          printer.println(itemLine);
          
          // Customization notes
          if (item.customization_notes) {
            printer.alignLeft();
            printer.println(`     *${item.customization_notes}`);
          }
        }
        printer.println('');
      });
    } else {
      // Regular items list (for new orders)
      items.forEach((item) => {
        const quantity = item.quantity || 1;
        const itemName = item.menu_item_name || 'Item';
        const portionSize = item.portion_size ? ` - ${item.portion_size}` : '';
        const itemLine = `X${quantity} - ${itemName}${portionSize}`;
        printer.println(itemLine);

        // Customization notes
        if (item.customization_notes) {
          printer.alignLeft();
          printer.println(`     *${item.customization_notes}`);
        }
        printer.println('');
      });
    }

    printer.drawLine('-');
    printer.println('');

    // Cut and beep
    printer.cut();
    printer.beep();

    // Execute print for network printer
    await printer.execute();

    console.log('[PRINTER 2] Print completed successfully');
    res.json({ success: true, message: 'Printed to Network Printer 1 (192.168.0.1)', printer: 'Printer 2' });

  } catch (error) {
    console.error('[PRINTER 2] Print error:', error);
    res.status(500).json({ 
      success: false, 
      error: `PRINTER 2 FAILED: ${error.message || error}`,
      printer: 'Printer 2'
    });
  }
});

// ============================================
// PRINTER 3: Network Printer 2 (192.168.0.199)
// Categories: All other categories
// ============================================
app.post('/forkitchenpr3', async (req, res) => {
  try {
    const { order, items, totals, restaurant, table, date, time, receiptId, address, phone, isUpdate, previousItems, newItems } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'No items provided for Printer 3' });
    }

    const hasPreviousItems = isUpdate && previousItems && Array.isArray(previousItems) && previousItems.length > 0;
    const hasNewItems = isUpdate && newItems && Array.isArray(newItems) && newItems.length > 0;

    if (isUpdate) {
      console.log(`[PRINTER 3] Printing order update - ${previousItems?.length || 0} previous items, ${newItems?.length || 0} new items`);
    } else {
      console.log(`[PRINTER 3] Printing ${items.length} items to Network Printer 2 (192.168.0.199)`);
    }

    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: 'tcp://192.168.0.199',
      options: { timeout: 30000 },
      width: 48,
      characterSet: CharacterSet.SLOVENIA
    });

    // Check if printer is connected (optional for network printers)
    try {
      const isConnected = await printer.isPrinterConnected();
      if (!isConnected) {
        console.warn('[PRINTER 3] Printer may not be connected at 192.168.0.199');
      }
    } catch (checkError) {
      console.warn('[PRINTER 3] Could not check connection:', checkError.message);
      // Continue anyway
    }

    // Header
    printer.setTextSize(0, 0);
    printer.println('');

    // Branch name
    printer.alignCenter();
    const branchName = 'South C Branch';
    const branchLine = `-------- ${branchName} --------`;
    printer.println(branchLine);
    printer.println('');

    // Order #, Table, Date, Time
    printer.alignLeft();
    const fullOrderId = receiptId || (order?.id || 'N/A');
    const orderNum = fullOrderId.length > 12 ? fullOrderId.slice(-10) : fullOrderId;
    printer.setTextSize(1, 1);
    printer.leftRight('Order #', orderNum);
    printer.setTextSize(0, 0);

    const tableNum = table || order?.table_number || 'N/A';
    const orderDate = date || new Date().toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
    const orderTime = time || new Date().toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      second: '2-digit', 
      hour12: true 
    });

    printer.leftRight('Table #', tableNum);
    printer.leftRight('Date', orderDate);
    printer.leftRight('Time', orderTime);
    
    // Show update indicator if this is an order update
    if (isUpdate) {
      printer.println('');
      printer.alignCenter();
      printer.bold(true);
      printer.println('*** ORDER UPDATE ***');
      printer.bold(false);
      printer.alignLeft();
    }
    
    printer.println('');
    printer.drawLine('-');
    printer.println('');

    // Previous Items (if this is an update)
    if (hasPreviousItems) {
      printer.alignLeft();
      printer.println('PREVIOUS ITEMS:');
      printer.println('');
      
      previousItems.forEach((item) => {
        const quantity = item.quantity || 1;
        const itemName = item.menu_item_name || 'Item';
        const portionSize = item.portion_size ? ` - ${item.portion_size}` : '';
        const itemLine = `X${quantity} - ${itemName}${portionSize}`;
        printer.println(itemLine);

        // Customization notes
        if (item.customization_notes) {
          printer.alignLeft();
          printer.println(`     *${item.customization_notes}`);
        }
        printer.println('');
      });
      
      printer.drawLine('-');
      printer.println('');
    }

    // New/Replaced Items
    if (hasNewItems) {
      printer.alignLeft();
      printer.bold(true);
      // Use different label based on whether it's a replacement or addition
      const isReplacement = newItems.length === 1 && hasPreviousItems;
      printer.println(isReplacement ? 'REPLACED ITEM:' : 'NEW ITEMS:');
      printer.bold(false);
      printer.println('');
      
      newItems.forEach((item) => {
        const quantity = item.quantity || 1;
        const itemName = item.menu_item_name || 'Item';
        const portionSize = item.portion_size ? ` - ${item.portion_size}` : '';
        const itemLine = `X${quantity} - ${itemName}${portionSize}`;
        
        // Invert text for replaced items to make them stand out
        if (isReplacement) {
          printer.invert(true);
          printer.println(itemLine);
          printer.invert(false);
          
          // Customization notes for replaced item (also inverted)
          if (item.customization_notes) {
            printer.invert(true);
            printer.alignLeft();
            printer.println(`     *${item.customization_notes}`);
            printer.invert(false);
          }
        } else {
          printer.println(itemLine);
          
          // Customization notes
          if (item.customization_notes) {
            printer.alignLeft();
            printer.println(`     *${item.customization_notes}`);
          }
        }
        printer.println('');
      });
    } else {
      // Regular items list (for new orders)
      items.forEach((item) => {
        const quantity = item.quantity || 1;
        const itemName = item.menu_item_name || 'Item';
        const portionSize = item.portion_size ? ` - ${item.portion_size}` : '';
        const itemLine = `X${quantity} - ${itemName}${portionSize}`;
        printer.println(itemLine);

        // Customization notes
        if (item.customization_notes) {
          printer.alignLeft();
          printer.println(`     *${item.customization_notes}`);
        }
        printer.println('');
      });
    }

    printer.drawLine('-');
    printer.println('');

    // Cut and beep
    printer.cut();
    printer.beep();

    // Execute print for network printer
    await printer.execute();

    console.log('[PRINTER 3] Print completed successfully');
    res.json({ success: true, message: 'Printed to Network Printer 2 (192.168.0.199)', printer: 'Printer 3' });

  } catch (error) {
    console.error('[PRINTER 3] Print error:', error);
    res.status(500).json({ 
      success: false, 
      error: `PRINTER 3 FAILED: ${error.message || error}`,
      printer: 'Printer 3'
    });
  }
});



app.post('/printitems', async (req, res) => {
  try {
    const { items, dateRange, restaurant, address, phone } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'No items provided' });
    }

    // Create printer commands
    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: PRINTER_INTERFACE,
      options: { timeout: 30000 },
      width: 48,
      characterSet: CharacterSet.SLOVENIA
    });

    // Calculate totals
    const totalQuantity = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
    const totalRevenue = items.reduce((sum, item) => sum + (item.total_price || 0), 0);

    // ============================================
    // MODERN RECEIPT DESIGN
    // ============================================

    // Top spacing
    printer.println('');

    // Restaurant Header - Small, slightly bold
    printer.alignCenter();
    printer.setTextSize(0, 0);
    printer.bold(true);
    printer.println('Orange Desserts');
    printer.bold(false);
    printer.println('');

    // Address & Contact - Small text
    if (address) {
      printer.println(address);
    } else {
      printer.println('South C Branch');
    }
    if (phone) {
      printer.println(`Tel: ${phone}`);
    } else {
      printer.println('Phone: 0723555569');
    }
    printer.println('');

    // Decorative line
    printer.drawLine();
    printer.println('');

    // Report Information Section
    printer.alignLeft();
    printer.setTextSize(0, 0);
    printer.println('ITEMS SOLD REPORT');
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

    printer.leftRight('Total Items:', `${items.length}`);
    printer.leftRight('Total Quantity:', `${totalQuantity}`);
    printer.leftRight('Total Revenue:', `Ksh ${totalRevenue.toFixed(2)}`);

    printer.println('');
    printer.drawLine();
    printer.println('');

    // ============================================
    // ITEMS LIST SECTION
    // ============================================
    printer.alignCenter();
    printer.bold(true);
    printer.println('ITEMS SOLD');
    printer.bold(false);
    printer.alignLeft();
    printer.println('');

    // Print each item
    items.forEach((item, index) => {
      const itemName = item.name || 'Unknown Item';
      const quantity = item.quantity || 0;
      const totalPrice = item.total_price || 0;

      // Item name (truncate if too long)
      const maxNameLength = 20;
      const displayName = itemName.length > maxNameLength 
        ? itemName.substring(0, maxNameLength - 3) + '...' 
        : itemName;
      
      printer.println(`${index + 1}. ${displayName}`);
      printer.leftRight('  Qty:', `${quantity}`);
      printer.leftRight('  Total:', `Ksh ${totalPrice.toFixed(2)}`);
      
      // Add separator between items (except last one)
      if (index < items.length - 1) {
        printer.println('');
      }
    });

    printer.println('');
    printer.drawLine();
    printer.println('');

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

    // 2. Get raw buffer
    const buffer = printer.getBuffer();
    
    // 3. Physically force the data to printer
    await forcePrint(buffer);
    
    res.json({ success: true, message: 'Items report printed successfully' });
  } catch (error) {
    console.error('Print items error:', error);
    return res.status(500).json({ 
      success: false, 
      error: `PRINT FAILED: ${error.message || error}` 
    });
  }
});


// Test print endpoint (GUARANTEED to work)
app.get('/force-test', async (req, res) => {
  
    const printer = new ThermalPrinter({
        type: PrinterTypes.EPSON,
        interface: 'tcp://192.168.0.199', // 'tcp://192.168.0.1' or 'COM3' or '/dev/ttyUSB0'
        options: {
            timeout: 5000,
        },
        width: 48,
        removeSpecialCharacters: false,
    });

    try {
        // Check if printer is connected (optional but recommended)
        const isConnected = await printer.isPrinterConnected();
        if (!isConnected) {
            throw new Error('Printer is not connected');
        }

        // Build your print content
        printer.alignCenter();
        printer.println('Receipt');
        printer.drawLine();

        printer.alignLeft();
        printer.println('Item 1...................$10.00');
        printer.println('Item 2...................$15.00');
        printer.drawLine();

        printer.alignRight();
        printer.setTextDoubleHeight();
        printer.println('Total: $25.00');
        printer.setTextNormal();

        printer.newLine();
        printer.cut();

        // Execute the print - this waits until printing is complete
        await printer.execute();
        console.log('Print completed successfully');
	res.json({ success: true, message: 'Receipt printed by force' });
    } catch (error) {
        console.error('Print error:', error);
        res.status(500).json({ error: `FORCE RECEIPT FAILED: ${error}` });
    }

});

// Receipt printing endpoint
app.post('/force-receipt', async (req, res) => {
  const printData = req.body;
  
  try {
    const printer = new ThermalPrinter({
  type: PrinterTypes.STAR,                                  // Printer type: 'star' or 'epson'
  interface: 'tcp://192.168.0.11',                       // Printer interface
  characterSet: CharacterSet.PC852_LATIN2,                  // Printer character set
  removeSpecialCharacters: false,                           // Removes special characters - default: false
  lineCharacter: "=",                                       // Set character for lines - default: "-"
  breakLine: BreakLine.WORD,                                // Break line after WORD or CHARACTERS. Disabled with NONE - default: WORD
  options:{                                                 // Additional options
    timeout: 5000                                           // Connection timeout (ms) [applicable only for network printers] - default: 3000
  }
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
