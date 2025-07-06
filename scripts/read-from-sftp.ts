import Client from 'ssh2-sftp-client';
import * as dotenv from 'dotenv';
import { Readable } from 'stream';
import { parse } from 'csv-parse';
import { PrismaClient} from '@prisma/client';

dotenv.config();
const prisma = new PrismaClient();

const sftp = new Client();

// SFTP connection configuration
const config = {
    host: process.env.SFTP_HOST,
    port: Number('2377'), // default SFTP port is 22
    username: process.env.SFTP_USERNAME,
    password: process.env.SFTP_PASSWORD, // You can use privateKey for more security
};


const getTodayDate = (): string => {
    const today = new Date();
    const year = today.getFullYear().toString();
    const month = (today.getMonth() + 1).toString().padStart(2, '0'); // Months are zero-based
    const day = today.getDate().toString().padStart(2, '0');
    return `${year}${month}${day}`;
};

async function convertToUTC(dateString: string): Promise<Date> {
    if (!dateString) return new Date(0)
    // Extract the date and time parts
    const [datePart, timePart] = dateString.split(' - ');

    // Parse the date and time components
    const [day, month, year] = datePart.split('/').map(Number);
    const [hours, minutes, seconds] = timePart.split(':').map(Number);

    // Create a UTC Date object
    const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));

    // Adjust for GMT +7 by subtracting 7 hours
    date.setUTCHours(date.getUTCHours() - 7);

    return date;
}

async function storeSettlement(record: any){
    try {
        const settlementTime = await convertToUTC(record['settlement (GMT +7)'])
        const settlementObj = await prisma.settlement.create({
            data: {
                transactionId: record['partner_trx_id'],
                settlementTime: settlementTime,
                settlementObj: record
            }
        });
        console.log(settlementObj)
    } catch (error) {
        console.log(error)
    }
}

async function updateTransaction(record: any){
    try {
        const settlementTime = await convertToUTC(record['settlement (GMT +7)'])
        const settlementObj = await prisma.transaction_request.update({
            where: {
                id: record['partner_trx_id']
            },
            data: {
                status : "SETTLEMENT",
                settlementAt : settlementTime
            }
        });
        console.log(settlementObj)
    } catch (error) {
        console.log(error)
    }
}

async function readAndParseCsvFromSftp(filename: String) {
    try {
        await sftp.connect(config);
        console.log('Connected to SFTP server');

        const fileContent = await sftp.get(`/data/${filename}.csv`); // Returns a Buffer

        // Convert Buffer to a Readable Stream
        const stream = new Readable();
        stream.push(fileContent);
        stream.push(null); // End the stream

        // Create a CSV parser
        const parser = parse({
            columns: true, // Automatically extract column names from the first line
            skip_empty_lines: true
        });

        // Pipe the stream into the CSV parser
        stream.pipe(parser);

        // Read each record
        parser.on('readable', async () => {
            let record;
            while ((record = parser.read()) !== null) {
                console.log('Parsed record:', record);
                await storeSettlement(record)
                await updateTransaction(record)
            }
        });

        // Handle end of parsing
        parser.on('end', () => {
            console.log('CSV file parsing complete');
            sftp.end(); // Close SFTP connection
        });

        // Handle parsing errors
        parser.on('error', (err) => {
            console.error('Error while parsing CSV:', err);
        });
    } catch (err) {
        console.error('Error:', err);
    }
}


(async () => {
    try {
        let filename = process.argv[2];

        if (!filename) {
            filename = getTodayDate()
        }
        await readAndParseCsvFromSftp(filename);
    } catch (error) {
        console.error('Error executing the requests:', error);
    }
})();


