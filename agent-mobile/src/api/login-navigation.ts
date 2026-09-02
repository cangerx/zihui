let navigatingToLogin = false

export function navigateToLoginOnce(): boolean {
  const currentRoute = getCurrentPages().at(-1)?.route
  if (currentRoute === 'pages-sub/login/login' || navigatingToLogin) return false

  navigatingToLogin = true
  uni.navigateTo({
    url: '/pages-sub/login/login',
    complete: () => {
      setTimeout(() => {
        navigatingToLogin = false
      }, 800)
    },
  })
  return true
}
