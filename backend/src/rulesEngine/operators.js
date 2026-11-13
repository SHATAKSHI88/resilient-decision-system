// Operator registry. To add an operator: add a function here and its name to constants.OPERATORS.
// Each function receives (actual, expected) with actual guaranteed present, returns boolean.
const isNumeric = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));

function looseEquals(a, b) {
  if (isNumeric(a) && isNumeric(b)) return Number(a) === Number(b);
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a).toLowerCase() === String(b).toLowerCase();
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

// Ordering operators only make sense for numbers; non-numeric input is "not comparable" -> false.
const compare = (fn) => (a, e) => (isNumeric(a) && isNumeric(e) ? fn(Number(a), Number(e)) : false);
const asList = (e) => (Array.isArray(e) ? e : [e]);

const operators = {
  EQUALS: (a, e) => looseEquals(a, e),
  NOT_EQUALS: (a, e) => !looseEquals(a, e),
  GREATER_THAN: compare((a, e) => a > e),
  GREATER_THAN_OR_EQUAL: compare((a, e) => a >= e),
  LESS_THAN: compare((a, e) => a < e),
  LESS_THAN_OR_EQUAL: compare((a, e) => a <= e),
  IN: (a, e) => asList(e).some((x) => looseEquals(a, x)),
  NOT_IN: (a, e) => !asList(e).some((x) => looseEquals(a, x)),
};

module.exports = { operators, isNumeric };
