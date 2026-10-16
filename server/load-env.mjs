import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Load project configuration before any env-dependent module initializes.
// The override also lets isolated child-process tests use a temporary .env.
const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const envFile=process.env.CHAINDETECTIVE_ENV_FILE||path.join(projectRoot,'.env');
try{process.loadEnvFile(envFile);}catch(error){if(error.code!=='ENOENT')throw error;}
