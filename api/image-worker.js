/**
 * image-worker.js — Background Worker Thread for Image Compression
 * 
 * Offloads CPU-intensive Sharp operations from the main event loop.
 * This runs on a SEPARATE OS thread via Node.js Worker Threads.
 * 
 * Compatible with GCP Cloud Run (stateless, zero external deps).
 */

import { parentPort, workerData } from 'worker_threads';
import sharp from 'sharp';

// Disable Sharp cache in worker thread too (memory safety on Cloud Run)
sharp.cache(false);

async function processImages(buffers, options = {}) {
    const { width = 512, height = 512, quality = 50 } = options;
    
    const results = await Promise.all(buffers.map(async (bufData, idx) => {
        try {
            const buf = Buffer.from(bufData); // Re-create Buffer from transferred data
            const metadata = await sharp(buf).metadata();
            const originalSizeKB = (buf.length / 1024).toFixed(2);
            
            const optimized = await sharp(buf)
                .resize(width, height, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality })
                .toBuffer();
            
            const optMetadata = await sharp(optimized).metadata();
            const optSizeKB = (optimized.length / 1024).toFixed(2);
            const reduction = ((1 - optimized.length/buf.length) * 100).toFixed(1);
            
            console.log(`[Compression Stats - Img ${idx}]`);
            console.log(`  └─ Original  : ${metadata.width}x${metadata.height}px, ${originalSizeKB}KB`);
            console.log(`  └─ Optimized : ${optMetadata.width}x${optMetadata.height}px, ${optSizeKB}KB (-${reduction}%)`);
            
            return { success: true, index: idx, data: optimized };
        } catch (err) {
            console.error(`[Worker] Image ${idx} compression failed: ${err.message}`);
            return { success: false, index: idx, data: bufData }; // Return original on failure
        }
    }));

    return results;
}

// Execute when the worker receives data from the main thread
(async () => {
    try {
        const { buffers, options } = workerData;
        const results = await processImages(buffers, options);
        parentPort.postMessage(results);
    } catch (err) {
        parentPort.postMessage({ error: err.message });
    }
})();
