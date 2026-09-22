const form = document.getElementById('oauth-form')
const clientIdInput = document.getElementById('client-id')
const clientSecretInput = document.getElementById('client-secret')
const submitButton = document.getElementById('submit-button')
const status = document.getElementById('status')
let pending = false

function showStatus(message, error = false) {
  status.textContent = message
  status.dataset.error = String(error)
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (pending || !form.reportValidity()) return
  if (!window.figmaOAuthSetup?.save) {
    showStatus('请在 Astrix 客户端内打开此设置窗口。', true)
    return
  }
  pending = true
  submitButton.disabled = true
  showStatus('正在安全保存连接信息…')
  try {
    const result = await window.figmaOAuthSetup.save({
      clientId: clientIdInput.value,
      clientSecret: clientSecretInput.value,
    })
    if (!result?.ok) {
      showStatus(result?.message || '保存失败，请检查连接信息后重试。', true)
      return
    }
    clientSecretInput.value = ''
    showStatus('已保存。请在系统浏览器中完成 Figma 授权。')
  } catch {
    showStatus('暂时无法保存，请重试。', true)
  } finally {
    pending = false
    submitButton.disabled = false
  }
})
