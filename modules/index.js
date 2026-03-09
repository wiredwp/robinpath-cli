/**
 * RobinPath Native Modules — Barrel Export
 * All modules listed here are bundled into the CLI binary.
 */

// Phase 1: Core System
import FileModule from './file.js';
import PathModule from './path.js';
import ProcessModule from './process.js';
import OsModule from './os.js';

// Phase 2: Data & Security
import CryptoModule from './crypto.js';
import BufferModule from './buffer.js';
import UrlModule from './url.js';
import ChildModule from './child.js';
import TimerModule from './timer.js';

// Phase 3a: Networking & I/O
import HttpModule from './http.js';
import NetModule from './net.js';
import DnsModule from './dns.js';
import EventsModule from './events.js';
import ZlibModule from './zlib.js';

// Phase 3b: Streams, TLS & Utilities
import StreamModule from './stream.js';
import TlsModule from './tls.js';
import UtilModule from './util.js';
import AssertModule from './assert.js';
import StringDecoderModule from './string_decoder.js';
import TtyModule from './tty.js';

// Phase 4: Document & Format Generation (uncomment as implemented)
// import ArchiveModule from './archive.js';
// import EmailModule from './email.js';
// import BarcodeModule from './barcode.js';
// import PdfModule from './pdf.js';
// import ExcelModule from './excel.js';

export const nativeModules = [
    // Phase 1: Core System
    FileModule,
    PathModule,
    ProcessModule,
    OsModule,

    // Phase 2: Data & Security
    CryptoModule,
    BufferModule,
    UrlModule,
    ChildModule,
    TimerModule,

    // Phase 3a: Networking & I/O
    HttpModule,
    NetModule,
    DnsModule,
    EventsModule,
    ZlibModule,

    // Phase 3b: Streams, TLS & Utilities
    StreamModule,
    TlsModule,
    UtilModule,
    AssertModule,
    StringDecoderModule,
    TtyModule,

    // Phase 4
    // ArchiveModule,
    // EmailModule,
    // BarcodeModule,
    // PdfModule,
    // ExcelModule,
];
