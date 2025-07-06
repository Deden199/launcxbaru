import axios from 'axios';
import { config } from '../config';

// Function to create headers for the Telegram bot
const createTelegramHeaders = () => {
    return {
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };
};

// Create axios instance for Telegram
const telegramAxiosInstance = axios.create({
    baseURL: `https://api.telegram.org/bot${config.api.telegram.botToken}`,
    headers: createTelegramHeaders(),
});

// Function to send a message
const sendTelegramMessage = async (chatId : string, text : string) => {
    try {
        const response = await telegramAxiosInstance.post('/sendMessage', {
            chat_id: chatId,
            text: text,
        });
        return response.data;
    } catch (error) {
        console.error('Error sending message:', error);
        throw error;
    }
};

export { telegramAxiosInstance, sendTelegramMessage};