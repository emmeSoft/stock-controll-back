// utils/money.js
// Sole Decimal API surface for the whole codebase.
// Decimal implementation comes from Prisma.Decimal (bundled with @prisma/client),
// NOT from a separately-installed decimal.js — zero new dependencies.
// Native `+ - < > ===` on money values are banned outside this file; use these
// helpers everywhere a monetary amount is constructed, rounded, summed, or compared.

const { Prisma } = require("@prisma/client");

const D = Prisma.Decimal;
const SCALE = 2;
const MODE = D.ROUND_HALF_UP;

/**
 * Construct a Decimal from any input Prisma.Decimal already accepts
 * (number, string, Decimal, null/undefined). The ONLY `new D(...)` call
 * in the codebase — everything else goes through this function.
 * `null`/`undefined` become Decimal(0).
 */
const money = (v) => new D(v ?? 0);

/**
 * Round a value to 2 decimal places using HALF_UP, returning a Decimal.
 */
const round = (v) => money(v).toDecimalPlaces(SCALE, MODE);

/**
 * Round and unwrap to a plain JS number. The ONLY Decimal -> Number
 * conversion in the codebase — used at the API boundary (serializer,
 * Excel export) and nowhere else.
 */
const toNumber = (v) => round(v).toNumber();

/**
 * Sum an array of values, optionally extracting the money value from
 * each element via `f`. Returns a Decimal.
 */
const sum = (xs, f = (x) => x) =>
  xs.reduce((acc, x) => acc.plus(money(f(x))), money(0));

/**
 * True only for a finite, strictly-positive amount. Used to validate
 * monetary input (e.g. `movimientosServices.createMovement`) where
 * negative, zero, NaN, or Infinity must be rejected.
 */
const isPositiveAmount = (v) => {
  try {
    const d = money(v);
    return d.isFinite() && d.gt(0);
  } catch {
    return false;
  }
};

module.exports = { money, round, toNumber, sum, isPositiveAmount, D };
