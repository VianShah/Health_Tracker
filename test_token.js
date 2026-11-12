// Check an access token against the server's JWT_SECRET (read from .env).
// Usage: node test_token.js <token>
import 'dotenv/config';
import jwt from 'jsonwebtoken';

const token = process.argv[2];
const secret = process.env.JWT_SECRET;

if (!token) {
    console.error('Usage: node test_token.js <token>');
    process.exit(1);
}
if (!secret) {
    console.error('JWT_SECRET is not set in .env');
    process.exit(1);
}

try {
    const decoded = jwt.verify(token, secret);
    console.log('✅ Token is valid:', decoded);
} catch (err) {
    console.error('❌ Token validation failed:', err.message);
    console.log('Decoded without verification:', jwt.decode(token));
}
