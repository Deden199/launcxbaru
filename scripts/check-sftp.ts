import Client from 'ssh2-sftp-client';
import { config } from '../src/config';
import { getTodayDateInJakartaFormat, getNestedValue} from '../src/util/util'
import { sendTelegramMessage } from '../src/core/telegram.axios';

const sftp = new Client();

// SFTP connection configuration
const sftpConfig = {
    host: process.env.SFTP_HOST,
    port: Number('2377'), // default SFTP port is 22
    username: process.env.SFTP_USERNAME,
    password: process.env.SFTP_PASSWORD, // You can use privateKey for more security
};

// Function that will be executed every hour
async function executeHourlyEvent() {
    try {
        await sftp.connect(sftpConfig);
        const fileList = await sftp.list('/data');
        // Get the last 5 files (no sorting)
        const lastFiveFiles = fileList.slice(-5).map(file => file.name);

        // Print file names with a newline between each
        const firstText = "Last 5 files in /data directory:\n" + lastFiveFiles.join('\n');

        const todayFileName = `${getTodayDateInJakartaFormat()}.csv`;

        const containsTodayFile = lastFiveFiles.includes(todayFileName);

        const secondText = `Does the list contain today's file (${todayFileName})? ${containsTodayFile}`;

        const message = `${firstText}\n\n${secondText}`
        await sendTelegramMessage(getNestedValue(config, 'api.telegram.adminChannel'), message);
        console.log(message);

    } catch (error) {
        console.error('Error executing the requests:', error);
    } finally {
        await sftp.end();
    }
}

// Convert one hour to milliseconds (1 hour = 60 minutes * 60 seconds * 1000 milliseconds)
const oneHour = 60 * 60 * 1000;

// Schedule the function to run every hour
setInterval(executeHourlyEvent, oneHour);

// Optionally, execute it immediately on startup
executeHourlyEvent();
