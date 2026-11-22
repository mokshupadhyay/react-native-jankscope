Pod::Spec.new do |s|
  s.name         = "jankscope-example-helpers"
  s.version      = "0.0.1"
  s.summary      = "Example-only main-thread blocker for jankscope validation."
  s.homepage     = "https://github.com/mokshupadhyay/react-native-jankscope"
  s.license      = "MIT"
  s.authors      = "Moksh Upadhyay <mokshupadhyay4@gmail.com>"
  s.platforms    = { :ios => "15.1" }
  s.source       = { :path => "." }
  s.source_files = "ios/**/*.{h,m}"
  s.dependency "React-Core"
end
