import { toDate, type DbDate } from '../../../core/db/procedures.js';
import type { SfFieldsRow } from './sf-fields.models.js';

// ---- Data access: gpp.udt_invoice_sf_fields_result (sf_fields column of usp_invoice_get_by_code) ----

// gpp.udt_invoice_sf_fields_result (NULL until gpp.invoice_sf_fields has a row for this invoice)
export interface SfFieldsResult {
  invoice_1a_2a_cancel: string | null;
  first_invoice_number_cancel: string | null;
  second_invoice_number_cancel: string | null;
  ab_number: string | null;
  accounting_register: number | null;
  code_of_imputation: string | null;
  code_of_imputation_str: string | null;
  gp_code_of_imputation: string | null;
  cost_center: number | null;
  jde_number: string | null;
  nro_de_o6: string | null;
  po_number: string | null;
  x1_number: string | null;
  owner_legacy_id: string | null;
  user_legacy_id: string | null;
  adjustment_approval: string | null;
  branch_plant: string | null;
  center: string | null;
  code_type: string | null;
  drei: string | null;
  adjustment_doc: string | null;
  installment_payment: string | null;
  invoice_type: string | null;
  order_type: string | null;
  pending_reason: string | null;
  reject_reason: string | null;
  sub_process: string | null;
  area: string | null;
  cbs_observation: string | null;
  computation_formula: string | null;
  expense_type: string | null;
  admin_observation: string | null;
  approval_observation: string | null;
  attachment_name_before_change: string | null;
  credit_note_comments: string | null;
  distribution_type: string | null;
  notes: string | null;
  observation: string | null;
  reject_observation: string | null;
  client_email: string | null;
  admin_approved_date: DbDate | null;
  approval_date: DbDate | null;
  cae_expiration_date: DbDate | null;
  processed_date: DbDate | null;
  rejection_date: DbDate | null;
  cae_number: number | null;
  exchange_rate: number | null;
  payment_term: number | null;
  is_boortmal_invoice: boolean;
  bu_employee_approver_done: boolean;
  is_distribution: boolean;
  is_downloaded_invoice: boolean;
  has_po: boolean;
  is_high_priority: boolean;
  is_invoice_paid: boolean;
  need_approval: boolean;
  po_attached: boolean;
  vip_control_done: boolean;
  updated_at: DbDate;
  cantidad: number | null;
  description: string | null;
  ros_cuit_legacy_id: string | null;
  due_date_invoice: DbDate | null;
  producto: string | null;
}

export const mapSfFieldsResult = (r: SfFieldsResult): SfFieldsRow => ({
  invoice1a2aCancel: r.invoice_1a_2a_cancel,
  firstInvoiceNumberCancel: r.first_invoice_number_cancel,
  secondInvoiceNumberCancel: r.second_invoice_number_cancel,
  abNumber: r.ab_number,
  accountingRegister: r.accounting_register,
  codeOfImputation: r.code_of_imputation,
  codeOfImputationStr: r.code_of_imputation_str,
  gpCodeOfImputation: r.gp_code_of_imputation,
  costCenter: r.cost_center,
  jdeNumber: r.jde_number,
  nroDeO6: r.nro_de_o6,
  poNumber: r.po_number,
  x1Number: r.x1_number,
  ownerLegacyId: r.owner_legacy_id,
  userLegacyId: r.user_legacy_id,
  adjustmentApproval: r.adjustment_approval,
  branchPlant: r.branch_plant,
  center: r.center,
  codeType: r.code_type,
  drei: r.drei,
  adjustmentDoc: r.adjustment_doc,
  installmentPayment: r.installment_payment,
  invoiceType: r.invoice_type,
  orderType: r.order_type,
  pendingReason: r.pending_reason,
  rejectReason: r.reject_reason,
  subProcess: r.sub_process,
  area: r.area,
  cbsObservation: r.cbs_observation,
  computationFormula: r.computation_formula,
  expenseType: r.expense_type,
  adminObservation: r.admin_observation,
  approvalObservation: r.approval_observation,
  attachmentNameBeforeChange: r.attachment_name_before_change,
  creditNoteComments: r.credit_note_comments,
  distributionType: r.distribution_type,
  notes: r.notes,
  observation: r.observation,
  rejectObservation: r.reject_observation,
  clientEmail: r.client_email,
  adminApprovedDate: toDate(r.admin_approved_date),
  approvalDate: toDate(r.approval_date),
  caeExpirationDate: toDate(r.cae_expiration_date),
  processedDate: toDate(r.processed_date),
  rejectionDate: toDate(r.rejection_date),
  caeNumber: r.cae_number,
  exchangeRate: r.exchange_rate,
  paymentTerm: r.payment_term,
  isBoortmalInvoice: r.is_boortmal_invoice,
  buEmployeeApproverDone: r.bu_employee_approver_done,
  isDistribution: r.is_distribution,
  isDownloadedInvoice: r.is_downloaded_invoice,
  hasPo: r.has_po,
  isHighPriority: r.is_high_priority,
  isInvoicePaid: r.is_invoice_paid,
  needApproval: r.need_approval,
  poAttached: r.po_attached,
  vipControlDone: r.vip_control_done,
  updatedAt: toDate(r.updated_at)!,
  cantidad: r.cantidad,
  description: r.description,
  rosCuitLegacyId: r.ros_cuit_legacy_id,
  dueDateInvoice: toDate(r.due_date_invoice),
  producto: r.producto,
});
