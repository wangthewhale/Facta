import { useQuery, useMutation } from '@tanstack/react-query';
import { 
  getHealthCheckQueryKey, healthCheck,
  getListProductsQueryKey, listProducts,
  getGetProductByBarcodeQueryKey, getProductByBarcode,
  getGetProductQueryKey, getProduct,
  getGetProductEvaluationQueryKey, getProductEvaluation,
  getGetAlternativesQueryKey, getAlternatives,
  getGetScanHistoryQueryKey, getScanHistory,
  recordScan,
  createSubmission,
  getGetSubmissionQueryKey, getSubmission,
  confirmOcr,
  processOcr,
  getGetPreferencesQueryKey, getPreferences,
  savePreferences,
  getListRetailersQueryKey, listRetailers,
  getListCategoriesQueryKey, listCategories,
  submitCorrection,
  getGetShareCardQueryKey, getShareCard,
  getGetDashboardStatsQueryKey, getDashboardStats,
  getListRecentProductsQueryKey, listRecentProducts,
  getAdminListPendingQueryKey, adminListPending,
  adminVerifySubmission,
  adminRejectSubmission,
  adminUpdateProduct,
  getAdminListCorrectionsQueryKey, adminListCorrections
} from '@workspace/api-client-react';

// Wrappers that extract the data payload from Axios responses to match the expected generic return format
// Since the prompt states "data is T directly (no wrapper)", and the orval config generates custom fetch
// functions, we will just use the standard hooks exported.

// Wait, the instructions specify to import the use... hooks directly from @workspace/api-client-react.
// I will not manually create wrappers here. I will just import them directly in the components.
