export function getMobileUserTabAction(tab) {
  if (tab?.action === 'profile') {
    return { closeProfile: false, openProfile: true, nav: '' }
  }

  return {
    closeProfile: true,
    openProfile: false,
    nav: tab?.nav || ''
  }
}

export function isMobileUserTabSelected(tab, activeNav, isProfileOpen) {
  if (tab?.action === 'profile') return !!isProfileOpen
  return !!tab?.nav && activeNav === tab.nav
}
