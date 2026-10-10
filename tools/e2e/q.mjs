import { connect } from './cdp.mjs';
const { evaluate, close } = await connect();
console.log(JSON.stringify(await evaluate(process.argv[2])));
close();
