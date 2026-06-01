export function canShowReferralLink(roles = [], referralCode = '') {
  return roles.includes('agent') && !!String(referralCode).trim()
}
