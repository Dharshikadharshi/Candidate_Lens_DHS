import { api } from './api';
import type {
  StartValidationRequest,
  ResumeValidationReport,
  ResumeValidationHistoryResponse,
} from '../types/resumeValidation';

export const startResumeValidation = async (
  candidateId: string,
  payload?: StartValidationRequest
): Promise<ResumeValidationReport> => {
  const response = await api.post(`/candidates/${candidateId}/resume-validation`, payload);
  return response.data;
};

export const getResumeValidationHistory = async (
  candidateId: string
): Promise<ResumeValidationHistoryResponse> => {
  const response = await api.get(`/candidates/${candidateId}/resume-validation`);
  return response.data;
};

export const getResumeValidationReport = async (
  reportId: string
): Promise<ResumeValidationReport> => {
  const response = await api.get(`/resume-validation/${reportId}`);
  return response.data;
};

export const regenerateResumeValidation = async (
  reportId: string
): Promise<ResumeValidationReport> => {
  const response = await api.post(`/resume-validation/${reportId}/regenerate`);
  return response.data;
};

export const downloadResumeValidationReport = async (
  reportId: string,
  filename: string
): Promise<void> => {
  const response = await api.get(`/resume-validation/${reportId}/download`, {
    responseType: 'blob',
  });
  
  const blob = new Blob([response.data], { type: 'application/pdf' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  
  // Try to extract filename from Content-Disposition header if possible
  const contentDisposition = response.headers['content-disposition'];
  let actualFilename = filename;
  if (contentDisposition) {
    const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
    if (filenameMatch && filenameMatch.length === 2) {
      actualFilename = filenameMatch[1];
    }
  }
  
  link.setAttribute('download', actualFilename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};
