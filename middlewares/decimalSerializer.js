// middlewares/decimalSerializer.js
// Global res.json interceptor: the only place in the codebase that
// converts Prisma.Decimal -> Number for the HTTP response boundary.
// Services stay Decimal end-to-end; only the outgoing JSON body is
// deep-walked and rewritten here.
//
// Chosen over per-controller mapping (16 controllers / ~60 handlers,
// too easy to miss one), Prisma `$extends` (would convert at the READ
// boundary and make services lose Decimal arithmetic), and a
// `Decimal.prototype.toJSON` monkey-patch (mutates a vendored class
// globally, leaks into logs/ExcelJS unpredictably). See design.md
// "Decision: serialization at a single global res.json interceptor".
//
// Known gap (by design, NOT a bug here): Excel export handlers stream
// via excelService.generateExcel({ res, ... }) and never call
// res.json, so this interceptor does not reach them. Those 5 handlers
// are fixed separately by calling money.toNumber() before building
// the Excel row data (tracked as a later unit).

const { Prisma } = require("@prisma/client");
const { toNumber } = require("../utils/money");

/**
 * Recursively walk a response body, converting every Prisma.Decimal
 * instance to a plain Number rounded HALF_UP at 2 decimal places.
 * Arrays and plain objects are walked; Dates are left untouched
 * (encountering one with Object.entries would shred it into its
 * internal fields). Buffers are intentionally NOT special-cased:
 * nothing in this codebase sends a raw Buffer through res.json (file
 * uploads go through Cloudinary and come back as URL strings), so
 * handling it here would be speculative. If that ever changes, add a
 * `v instanceof Buffer` guard next to the Date check.
 */
const deepSerialize = (v) => {
  if (Prisma.Decimal.isDecimal(v)) return toNumber(v);
  if (Array.isArray(v)) return v.map(deepSerialize);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, deepSerialize(x)])
    );
  }
  return v;
};

/**
 * Express middleware: wraps res.json so every JSON response body is
 * deep-serialized before being sent. Must be mounted after
 * express.json() and before all route mounts so it wraps every
 * subsequent handler's res.json call.
 */
const decimalSerializer = (req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => json(deepSerialize(body));
  next();
};

module.exports = decimalSerializer;
module.exports.deepSerialize = deepSerialize;
