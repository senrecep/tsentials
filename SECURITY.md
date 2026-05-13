# Security Policy

## Supported Versions

The tsentials project maintains security updates for the latest minor version of each major release.

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | Yes (current)      |
| < 0.1   | No                 |

Security patches are released as patch versions (e.g., 0.1.5 → 0.1.6) on the npm registry.

## Reporting a Vulnerability

We take security vulnerabilities seriously and appreciate responsible disclosure.

### Preferred: GitHub Private Security Advisory

1. Navigate to https://github.com/senrecep/tsentials/security/advisories
2. Click "Report a vulnerability"
3. Provide vulnerability details:
   - Description of the issue
   - Affected version(s)
   - Steps to reproduce (if applicable)
   - Suggested fix (if you have one)

GitHub private advisories ensure your report reaches the maintainers securely before public disclosure.

### Fallback: Email

If you prefer email or cannot use GitHub:
- Send to: **me@senrecep.com**
- Subject line: `[SECURITY] tsentials vulnerability`
- Include the same details as above

### Response SLA

We aim to respond to all security reports within **48 hours**. We will:
1. Acknowledge receipt of your report
2. Confirm or dispute the vulnerability
3. Provide a timeline for a fix
4. Discuss coordinated disclosure if applicable

We request that you do not publicly disclose the vulnerability until we have released a fix and published a security advisory.

## Security Updates

Security vulnerabilities are addressed with priority. Fixes are released as patch versions following semantic versioning.

- **Patch releases** (0.1.x → 0.1.x+1) are used exclusively for security fixes
- **Security advisories** are published on the [GitHub Security tab](https://github.com/senrecep/tsentials/security/advisories) after release
- **Major/minor versions** continue on their normal release cycle; critical security fixes may trigger out-of-cycle releases

Users are encouraged to keep dependencies updated by watching GitHub releases or configuring dependabot alerts.

## General Security Guidelines

This is a utility library. Applications using tsentials are responsible for:

- **Input validation**: Use validation libraries (Zod, etc.) in addition to tsentials' type system
- **Error handling**: Never expose sensitive information in error messages
- **Dependencies**: Keep tsentials and its dependencies up to date
- **TypeScript strict mode**: Use `strict: true` in your tsconfig.json

## Questions?

For non-security questions, open an issue on [GitHub](https://github.com/senrecep/tsentials/issues) or contact me@senrecep.com.
