const currentAccountServices = require('../services/currentAccountServices');

// ── GET /api/accounts ─────────────────────────────────────────────
const getList = async (req, res) => {
  try {
    const { status } = req.query;
    const accounts = await currentAccountServices.getList(req.user, { status });
    res.json(accounts);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// ── GET /api/accounts/client/:clientId ────────────────────────────
const getByClient = async (req, res) => {
  try {
    const account = await currentAccountServices.getByClient(req.params.clientId, req.user);
    res.json(account);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// ── GET /api/accounts/:id ─────────────────────────────────────────
const getDetail = async (req, res) => {
  try {
    const account = await currentAccountServices.getDetail(req.params.id, req.user);
    res.json(account);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// ── POST /api/accounts/open ───────────────────────────────────────
const open = async (req, res) => {
  try {
    const { clientId } = req.body;
    if (!clientId) return res.status(400).json({ message: 'El campo clientId es requerido.' });

    const account = await currentAccountServices.open(clientId, req.user);
    res.status(201).json(account);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// ── PATCH /api/accounts/:id/close ────────────────────────────────
const close = async (req, res) => {
  try {
    const account = await currentAccountServices.close(req.params.id, req.user);
    res.json(account);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// ── POST /api/accounts/payment ────────────────────────────────────
const registerPayment = async (req, res) => {
  try {
    const { clientId, amount, paymentMethod, description } = req.body;

    if (!clientId)      return res.status(400).json({ message: 'El campo clientId es requerido.' });
    if (!amount)        return res.status(400).json({ message: 'El campo amount es requerido.' });
    if (!paymentMethod) return res.status(400).json({ message: 'El campo paymentMethod es requerido.' });

    const result = await currentAccountServices.registerPayment(
      { clientId, amount: parseFloat(amount), paymentMethod, description },
      req.user
    );
    res.status(201).json(result);
  } catch (err) {
    // caja-close-integrity: `code` is additive and gated on `err.status`
    // so Prisma's own `.code` never leaks into the response body.
    const code = err.status ? err.code : undefined;
    res.status(err.status || 500).json({ message: err.message, ...(code && { code }) });
  }
};

module.exports = { getList, getByClient, getDetail, open, close, registerPayment };
