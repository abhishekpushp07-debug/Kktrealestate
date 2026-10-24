import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const api = axios.create({ baseURL: API });
export const errMsg = (e, fallback = "Something went wrong") => e?.response?.data?.detail || e?.message || fallback;
export default api;
