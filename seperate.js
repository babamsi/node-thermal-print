// Separate endpoints for each printer category
// This approach routes items by category in the frontend and calls different endpoints

// ============================================
// PRINTER 1: Serial Printer (COM7)
// Categories: Juices, Milkshakes, Smoothies, Treat Cups, Boba Mojitos
// ============================================
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
    printer.leftRight('Order #', orderNum);

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
    printer.leftRight('Order #', orderNum);

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
    printer.leftRight('Order #', orderNum);

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

