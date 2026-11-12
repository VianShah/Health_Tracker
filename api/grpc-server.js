import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTO_PATH = path.join(__dirname, 'protos', 'nutriscan.proto');
const GRPC_PORT = parseInt(process.env.GRPC_PORT || '50051', 10);

// ── Load proto definition ────────────────────────────────────────────────────
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});
const nutriscanProto = grpc.loadPackageDefinition(packageDefinition).nutriscan;

// ── RPC Method Implementations ───────────────────────────────────────────────

function healthCheck(call, callback) {
    const uptime = process.uptime();
    const memory = process.memoryUsage();

    callback(null, {
        status: 'healthy',
        uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
        timestamp: new Date().toISOString(),
        version: '4.0.0',
        database: 'connected',
        environment: process.env.NODE_ENV || 'development',
        region: process.env.K_SERVICE ? 'GCP-CloudRun' : 'Local',
        memoryHeapUsedMB: parseFloat((memory.heapUsed / 1024 / 1024).toFixed(2)),
    });
}

function ping(call, callback) {
    callback(null, {
        message: 'pong',
        serverTime: Date.now(),
    });
}

// ── Server Bootstrap ─────────────────────────────────────────────────────────

export function startGrpcServer(port = GRPC_PORT) {
    const server = new grpc.Server();

    server.addService(nutriscanProto.NutriScanService.service, {
        HealthCheck: healthCheck,
        Ping: ping,
    });

    server.bindAsync(
        `0.0.0.0:${port}`,
        grpc.ServerCredentials.createInsecure(),
        (err, actualPort) => {
            if (err) {
                if (err.message.includes('EADDRINUSE')) {
                    console.error(`❌ gRPC server failed: Port ${port} is already in use.`);
                    console.error(`   To fix: Terminate orphaned Node processes or set a different GRPC_PORT in .env`);
                } else {
                    console.error(`❌ gRPC server failed to bind: ${err.message}`);
                }
                return;
            }
            console.log(`🚀 gRPC server listening on port ${actualPort}`);
        }
    );

    return server;
}
