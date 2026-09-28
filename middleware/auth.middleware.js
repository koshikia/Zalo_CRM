export function requireAuth(req, res, next) {
  if (!req.session?.accountId) {
    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    return res.redirect("/");
  }
  next();
}
