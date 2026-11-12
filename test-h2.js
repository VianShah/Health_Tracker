import http2 from 'http2';

const client = http2.connect('http://localhost:3002');
client.on('error', (err) => console.error('HTTP/2 Client Error:', err));

const req = client.request({ ':path': '/api/v1/health' });

req.on('response', (headers, flags) => {
  console.log('HTTP/2 Response Status:', headers[':status']);
  console.log('Protocol:', headers[':protocol'] || 'h2c');
});

req.setEncoding('utf8');
let data = '';
req.on('data', (chunk) => { data += chunk; });
req.on('end', () => {
  console.log('Response Body:', data);
  client.close();
});
