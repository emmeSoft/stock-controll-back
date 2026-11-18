/**
 * healthController.js — Wake endpoint handler.
 *
 * No DB access, no writes, no logging side effects. Exists solely so the
 * SPA can "wake" a sleeping free-tier backend instance (Render cold start)
 * via a call that can never fail for an unrelated reason (DB down, rate
 * limit, auth). Safe to call an unbounded number of times.
 */

const check = (req, res) => {
  res.json({
    status: 'ok',
    service: 'stock-controll-back',
    timestamp: new Date().toISOString(),
  });
};

module.exports = { check };
