require 'json'
require_relative 'ios/tileflow_native_admission'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
	s.name = 'TileflowNativeAdmission'
	s.version = package['version'].delete_suffix('-development')
	s.summary = 'Private asynchronous native resource admission for Tileflow.'
	s.homepage = package['homepage']
	s.authors = 'Tileflow'
	s.license = { :type => 'Apache-2.0', :file => File.exist?(File.join(__dir__, 'LICENSE')) ? 'LICENSE' : '../../LICENSE' }
	# This private development pod is consumed by local path/autolinking.
	s.source = { :git => 'https://github.com/tileflow/tileflow-sdk.git' }
	s.platforms = { :ios => '15.1' }
	s.source_files = 'ios/*.{h,mm}'
	s.private_header_files = 'ios/*.h'
	s.frameworks = 'Foundation', 'UIKit'
	s.libraries = 'c++'
	s.dependency 'React-Core', '0.83.10'
	s.dependency 'MapLibreReactNative', '11.3.10'
	# MapLibre itself is an exact SPM product, not a second CocoaPods SDK.
	install_modules_dependencies(s)

	s.test_spec 'Admission' do |tests|
		tests.source_files = 'ios/Tests/*.mm'
		tests.requires_app_host = true
	end
end
