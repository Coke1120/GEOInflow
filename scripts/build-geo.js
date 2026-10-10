import 'dotenv/config';
import { prepareGeoDatabase } from './liekan-geo.mjs';

const result = await prepareGeoDatabase();
if (result.state === 'unavailable') {
  process.exitCode = 1;
}
