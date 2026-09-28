import { api } from './api';
import type { ValidationHistoryResponse, ValidationReport } from '../types/validation';

export const startResumeValidation = async (candidateId: string, targetRole?: string, force = false): Promise<ValidationReport> => {
  return (await api.post<ValidationReport>(`/candidates/${candidateId}/resume-validation`, {
    target_role: targetRole || undefined,
    force,
  })).data;
};

export const getCandidateValidationHistory = async (candidateId: string): Promise<ValidationHistoryResponse> => {
  return (await api.get<ValidationHistoryResponse>(`/candidates/${candidateId}/resume-validation`)).data;
};

export const getValidationReport = async (reportId: string): Promise<ValidationReport> => {
  return (await api.get<ValidationReport>(`/resume-validation/${reportId}`)).data;
};

export const regenerateValidationReport = async (reportId: string, targetRole?: string): Promise<ValidationReport> => {
  return (await api.post<ValidationReport>(`/resume-validation/${reportId}/regenerate`, {
    target_role: targetRole || undefined,
    force: true,
  })).data;
};

export const downloadValidationPdf = async (reportId: string, filename?: string): Promise<void> => {
  const response = await api.get(`/resume-validation/${reportId}/download`, {
    responseType: 'blob',
  });
  const blob = new Blob([response.data], { type: 'application/pdf' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename || `Resume_Validation_${reportId}.pdf`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};
