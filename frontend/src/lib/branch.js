/** Flat alternatives instead of nested ternaries (CR-4.5).
 *  pick(test1, value1, test2, value2, …, fallback) → first value whose test is truthy, else fallback.
 *  branch(test1, () => jsx1, test2, () => jsx2, …, () => fallback) → same, but each branch is a thunk so only the chosen one renders. */
export function pick(...args) {
  for (let i = 0; i + 1 < args.length; i += 2) if (args[i]) return args[i + 1];
  return args[args.length - 1];
}
export function branch(...args) {
  for (let i = 0; i + 1 < args.length; i += 2) if (args[i]) return args[i + 1]();
  return args[args.length - 1]();
}
