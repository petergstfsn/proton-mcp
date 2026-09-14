# Homebrew formula for proton-mail-bridge-client
# Users install with: brew install googlarz/tap/proton-mail-bridge-client

require "language/node"

class ProtonMailBridgeClient < Formula
  desc "Full-featured CLI and Claude Desktop MCP for Proton Mail via Proton Bridge"
  homepage "https://github.com/googlarz/proton-mail-bridge-client"
  url "https://registry.npmjs.org/proton-mail-bridge-client/-/proton-mail-bridge-client-2.0.8.tgz"
  sha256 "c1a39fa176a755f054ce56161b5a59c927285c75f9e41cacd5d3d98b530b06c8"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  def caveats
    <<~EOS
      Proton Mail Bridge must be running before using this tool.
      Download Bridge at: https://proton.me/mail/bridge

      Required environment variables (add to ~/.zshrc or ~/.bash_profile):
        export PROTONMAIL_USERNAME='you@proton.me'
        export PROTONMAIL_PASSWORD='your-bridge-password'

      Then run: proton-mail-bridge-client status
    EOS
  end

  test do
    output = shell_output("#{bin}/proton-mail-bridge-client --version 2>&1")
    assert_match "2.0.8", output
  end
end
