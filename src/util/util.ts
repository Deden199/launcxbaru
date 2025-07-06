import moment from 'moment-timezone';

const getCurrentDate = (): string => {
    // Set the timezone to 'Asia/Jakarta'
    const jakartaDate = moment().tz('Asia/Jakarta');
    return jakartaDate.format();  // Default format is ISO 8601, includes timezone
}

const getNestedValue = (obj: any, path: string): any => {
    return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

function getTodayDateInJakartaFormat(): string {
    const today = new Date();
    const jakartaOffset = 7 * 60 * 60 * 1000; // UTC+7 in milliseconds
    const jakartaDate = new Date(today.getTime() + jakartaOffset);

    const year = jakartaDate.getUTCFullYear();
    const month = String(jakartaDate.getUTCMonth() + 1).padStart(2, '0'); // Months are 0-based, so add 1
    const day = String(jakartaDate.getUTCDate()).padStart(2, '0');

    return `${year}${month}${day}`;
}

export { getCurrentDate, getNestedValue, getTodayDateInJakartaFormat};