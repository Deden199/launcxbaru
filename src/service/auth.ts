import axios from 'axios';
import { config } from '../config';

export const generateToken = async (creds: AuthCredential) => {
  const audience = config.api.auth0.audience!;
  const domain = config.api.auth0.domain!;

  const TOKEN_URL = `https://${domain}/oauth/token`;

  try {
    const response = await axios.post(
      TOKEN_URL,
      {
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_assertion: creds.signedJwt,
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        audience,
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    return response.data.access_token;
  } catch (error: any) {
    console.error('Error generating token:', error.response?.data || error.message);
    throw new Error('Failed to generate access token');
  }
};
