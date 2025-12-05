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


    // ============================================
    // MODERN RECEIPT DESIGN
    // ============================================

    // Top spacing
    printer.println('');

    // Restaurant Header - Small, slightly bold
    printer.alignCenter();
    printer.setTextSize(0, 0);
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
