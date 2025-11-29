const Service = require('node-windows').Service;
const path = require('path');

// Use absolute path - VERY IMPORTANT!
const scriptPath = path.join(__dirname, 'server.js');

console.log('Installing service for:', scriptPath);

// Create a new service object
const svc = new Service({
  name: 'Thermal Printer Server',
  description: 'ESC/POS Thermal Printer Server',
  script: scriptPath,
  nodeOptions: [
    '--harmony',
    '--max_old_space_size=4096'
  ],
  // Add working directory
  workingDirectory: __dirname,
  env: {
    name: "NODE_ENV",
    value: "production"
  }
});

// Listen for the "install" event
svc.on('install', function() {
  console.log('Service installed successfully!');
  svc.start();
});

// Listen for start
svc.on('start', function() {
  console.log('Service started successfully!');
});

// Listen for errors
svc.on('error', function(err) {
  console.error('Service error:', err);
});

// Install the service
svc.install();
