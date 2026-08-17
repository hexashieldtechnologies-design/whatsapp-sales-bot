function getPassword() {
  return process.env.ADMIN_PASSWORD || 'dev';
}
