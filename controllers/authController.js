const authServices = require('../services/authServices');

const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await authServices.loginUser(email, password);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

module.exports = { login };
