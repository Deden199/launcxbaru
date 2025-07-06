import axios from 'axios';
import { config } from '../config';

const createBrevoHeaders = () => {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'api-key': config.api.brevo.apiKey
    };
    return headers;
};

const brevoAxiosInstance = axios.create({
    baseURL: `${config.api.brevo.url}`,
    headers: createBrevoHeaders(),
});

export { brevoAxiosInstance };