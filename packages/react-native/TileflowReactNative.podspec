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
	# The Map's surface integration consumes only the private native view/camera headers of the
	# pinned MapLibre React Native peer, which the app installs. It is not a pod dependency: that pod
	# defines no module, and this pod's Swift would then need modular headers everywhere.
	# No Tileflow native header is promoted to a public CocoaPods header.
	s.pod_target_xcconfig = {
		'DEFINES_MODULE' => 'YES',
		'HEADER_SEARCH_PATHS' => '$(inherited) "${PODS_ROOT}/Headers/Private" "${PODS_ROOT}/Headers/Private/MapLibreReactNative"'
	}
	# MapLibre and the Tileflow Swift SDK are exact Swift package products, linked by
	# tileflow_post_install(installer) from the app's Podfile.
	install_modules_dependencies(s)

	s.test_spec 'Admission' do |tests|
		tests.source_files = 'ios/Tests/*.mm'
		tests.requires_app_host = true
	end
end
