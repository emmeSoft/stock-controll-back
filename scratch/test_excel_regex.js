// Simple regex test to verify Excel sanitization logic
const testRegex = (val) => {
    const regex = /^[=+\-@\s]/;
    const isFormula = typeof val === 'string' && regex.test(val);
    console.log(`Value: "${val.padEnd(12)}" | Is Formula: ${isFormula.toString().padEnd(6)} | Escaped: ${isFormula ? "'" + val : val}`);
};

console.log('--- Testing Excel Sanitization Regex (Anti-Injection) ---');
testRegex('=SUM(A1)');
testRegex('+123');
testRegex('-456');
testRegex('@SUM');
testRegex(' @SUM'); // Starting with space is also a trigger in some Excel versions
testRegex('Normal Text');
testRegex('123');
testRegex('=');
testRegex('');
testRegex('  ');
