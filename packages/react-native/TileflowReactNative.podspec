require 'json'
require_relative 'ios/tileflow_post_install'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
	s.name = 'TileflowReactNative'
	s.version = package['version'].delete_suffix('-development')
	s.summary = 'Tileflow maps, offline regions and services for React Native.'
	s.homepage = package['homepage']
	s.authors = 'Tileflow'
	s.license = { :type => 'Apache-2.0', :file => File.exist?(File.join(__dir__, 'LICENSE')) ? 'LICENSE' : '../../LICENSE' }
	# Consumed by local path through autolinking.
	s.source = { :git => 'https://github.com/tileflow/tileflow-sdk.git' }
	s.platforms = { :ios => '16.0' }
	s.source_files = 'ios/*.{h,mm}', 'ios/Sources/*.swift'
	s.private_header_files = 'ios/*.h'
	s.swift_version = '5.9'
	s.frameworks = 'Foundation', 'UIKit'
	s.libraries = 'c++'
	s.dependency 'React-Core', '0.83.10'
	s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
	# Swift package products are linked by the app's tileflow_post_install hook.
	install_modules_dependencies(s)

end
