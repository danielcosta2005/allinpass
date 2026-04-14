import QrScanner from 'qr-scanner';
import workerUrl from 'qr-scanner/qr-scanner-worker.min.js?url';

QrScanner.WORKER_PATH = workerUrl;

export default QrScanner;