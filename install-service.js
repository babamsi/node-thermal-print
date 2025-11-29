const Service = require('node-windows').Service;

// Create a new service object
const svc = new Service({
  name: 'Thermal Printer Server',
  description: 'ESC/POS Thermal Printer Server',
  script: 'C:\\path\\to\\your\\app.js', // Full path to your main file
  nodeOptions: [
    '--harmony',
    '--max_old_space_size=4096'
  ],
  env: {
    name: "NODE_ENV",
    value: "production"
  }
});

// Listen for the "install" event
svc.on('install', function() {
  svc.start();
  console.log('Service installed and started!');
});

// Install the service
svc.install();
