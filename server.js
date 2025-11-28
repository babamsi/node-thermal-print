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
    const { order, items, totals, restaurant, table, date, time, receiptId } = req.body;

    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: 'tcp://192.168.1.112', // <-- Set your printer's IP here
      options: { timeout: 1000 },
      width: 48,
      characterSet: CharacterSet.SLOVENIA,
      breakLine: BreakLine.WORD,
      removeSpecialCharacters: false,
      lineCharacter: '-',
    });

     // Header
    printer.alignCenter();
    printer.println(restaurant || 'RESTAURANT NAME');
    printer.println('123 Main Street, City');
    printer.println('Phone: (123) 456-7890');
    printer.drawLine();

    printer.alignLeft();
    printer.println(`Order #: ${receiptId || order?.id?.slice(-6)}`);
    printer.println(`Table: ${table || order?.table_number}`);
    printer.println(`Date: ${date || new Date().toLocaleDateString()}`);
    printer.println(`Time: ${time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    printer.drawLine();

    // Items
    items.forEach((item) => {
      printer.println(`${item.name}${item.portion_size ? ` (${item.portion_size})` : ''}`);
      if (item.customization_notes) {
        printer.println(`  *${item.customization_notes}`);
      }
      printer.leftRight(
        `x${item.quantity} @ ${item.unit_price.toFixed(2)}`,
        (item.total_price || (item.unit_price * item.quantity)).toFixed(2)
      );
    });
    printer.drawLine();

    // Totals
    printer.println(`Subtotal: Ksh ${totals?.subtotal?.toFixed(2)}`);
    printer.println(`Tax (16%): Ksh ${totals?.tax?.toFixed(2)}`);
    printer.println(`Total: Ksh ${totals?.total?.toFixed(2)}`);
    printer.drawLine();

    printer.alignCenter();
    printer.println('Thank you for dining with us!');
    printer.cut();
    printer.openCashDrawer();

    // Print
    const isConnected = await printer.isPrinterConnected();
    if (!isConnected) {
      return NextResponse.json({ success: false, error: 'Printer not connected' }, { status: 500 });
    }
    await printer.execute();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Print error' });
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
