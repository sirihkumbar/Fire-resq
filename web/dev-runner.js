const { spawn } = require('child_process');
const os = require('os');

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  const preferred = [];
  const fallback = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family !== 'IPv4' || iface.internal) continue;

      const entry = { name, address: iface.address };
      if (/wi-?fi|wireless|ethernet/i.test(name) && !/virtual|vEthernet|WSL|docker|vmware|virtualbox|hyper-v/i.test(name)) {
        preferred.push(entry);
      } else if (!/virtual|vEthernet|WSL|docker|vmware|virtualbox|hyper-v/i.test(name)) {
        fallback.push(entry);
      }
    }
  }

  return (preferred[0] || fallback[0])?.address || 'localhost';
}

const localIP = getLocalIP();
const port = 3000;

// Run Next.js listening on 0.0.0.0 so network IP works on phone/other devices
const nextProcess = spawn('npx', ['next', 'dev', '-H', '0.0.0.0', '-p', String(port)], {
  shell: true,
  stdio: ['inherit', 'pipe', 'inherit']
});

let shown = false;

nextProcess.stdout.on('data', (data) => {
  const text = data.toString();
  if (!shown && (text.includes('Ready') || text.includes('ready') || text.includes('started'))) {
    shown = true;
    console.clear();
    console.log(`
 

Station Control Room:                                                   
- Local:   http://localhost:${port}          
- Network: http://${localIP}:${port}                                                                                                 

Responder Portal:                                                       
- Local:   http://localhost:${port}/responder                           
- Network: http://${localIP}:${port}/responder                          
                                                                       
Citizen SOS:                                                           
- Local:   http://localhost:${port}/sos                                 
- Network: http://${localIP}:${port}/sos                                
`);
  }
});