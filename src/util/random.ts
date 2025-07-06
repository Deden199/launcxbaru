const generateRandomId = (length: number = 32): string => {
        const charset = '0123456789';
    let randomString = '';
    
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * charset.length);
        randomString += charset.charAt(randomIndex);
  }
  return randomString;
}

const getRandomNumber = (max : number): number => {
    return Math.floor(Math.random() * (max + 1));
}

export {generateRandomId, getRandomNumber};
