import axios from 'axios'

const merchantApi = axios.create({
  baseURL: '/api/v1/merchant',
  // kalau perlu header auth sama dengan `api`
})

export default merchantApi
