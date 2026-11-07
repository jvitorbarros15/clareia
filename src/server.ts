import {createApp} from './app.ts';

const port=Number(process.env.PORT||4174);
createApp('dist',port).listen(port,'127.0.0.1',()=>console.log(`Clareia: http://127.0.0.1:${port}`));
