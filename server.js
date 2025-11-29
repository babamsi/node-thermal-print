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
    const tableNum = table || order?.table_number || 'N/A';
    const orderDate = date || new Date().toLocaleDateString();
    const orderTime = time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    printer.leftRight('Order #:', orderNum);
    printer.leftRight('Table:', tableNum);
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
