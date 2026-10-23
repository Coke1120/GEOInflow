/** Validate a candidate upgrade while preserving independently applied migration records. */
export function assertMigrationUpgrade(before, after, candidate) {
  const previous = new Map(before.map(row => [row.name, row]));
  const current = new Map(after.map(row => [row.name, row]));
  const expected = new Set([...previous.keys(), ...Object.keys(candidate)]);
  if (
    previous.size !== before.length ||
    current.size !== after.length ||
    current.size !== expected.size
  )
    throw new Error('Restored candidate migration count differs');
  for (const name of expected) {
    const prior = previous.get(name),
      row = current.get(name);
    if (
      !row ||
      (prior && (row.checksum !== prior.checksum || row.appliedAt !== prior.appliedAt)) ||
      (Object.hasOwn(candidate, name) && row.checksum !== candidate[name])
    )
      throw new Error(`Restored candidate migration evidence differs: ${name}`);
  }
  return [...previous.keys()].filter(name => !Object.hasOwn(candidate, name));
}
