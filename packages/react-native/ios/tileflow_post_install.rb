require 'json'
require 'pathname'

# Links the exact Swift package products the TileflowReactNative pod uses. Call it from the app's
# Podfile post_install, after React Native's hook:
#
#   post_install do |installer|
#     react_native_post_install(installer, ...)
#     tileflow_post_install(installer)
#   end
#
# It only adds Swift package references and products to the pod targets. It never installs a
# shell phase or changes a pin. Release builds use the Tileflow Swift package at the version this
# package pins; set TILEFLOW_SWIFT_PACKAGE_PATH to a local package, such as a native candidate or
# this repository's platforms/ios, to build against it instead.
TILEFLOW_SWIFT_PRODUCTS = %w[Tileflow TileflowServices].freeze

def tileflow_post_install(installer, swift_package_path: ENV['TILEFLOW_SWIFT_PACKAGE_PATH'])
	project = installer.pods_project
	targets = tileflow_pod_targets(project)
	package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))
	reference = if swift_package_path && !swift_package_path.empty?
		path = File.expand_path(swift_package_path, installer.sandbox.root.dirname)
		raise "No Swift package at #{path}" unless File.exist?(File.join(path, 'Package.swift'))
		relative = Pathname.new(path).relative_path_from(Pathname.new(project.project_dir)).to_s
		tileflow_package_reference(project, Xcodeproj::Project::Object::XCLocalSwiftPackageReference, :relative_path, relative) do |found|
			found.relative_path = relative
		end
	else
		url = package.dig('tileflow', 'swiftPackage')
		version = package.dig('tileflow', 'nativeVersion')
		tileflow_package_reference(project, Xcodeproj::Project::Object::XCRemoteSwiftPackageReference, :repositoryURL, url) do |found|
			found.requirement = { 'kind' => 'exactVersion', 'version' => version }
		end
	end
	targets.each do |target|
		TILEFLOW_SWIFT_PRODUCTS.each { |name| tileflow_link_product(project, target, reference, name) }
		# Swift package modules are built beside the pods, where the pod's Swift finds them.
		target.build_configurations.each do |config|
			paths = Array(config.build_settings['SWIFT_INCLUDE_PATHS'] || '$(inherited)')
			search = '${SYMROOT}/${CONFIGURATION}${EFFECTIVE_PLATFORM_NAME}/'
			config.build_settings['SWIFT_INCLUDE_PATHS'] = paths + [search] unless paths.include?(search)
		end
	end
end

def tileflow_package_reference(project, type, key, value)
	reference = project.root_object.package_references.find do |candidate|
		candidate.is_a?(type) && candidate.send(key) == value
	end
	unless reference
		reference = project.new(type)
		reference.send("#{key}=", value)
		project.root_object.package_references << reference
	end
	yield reference
	reference
end

def tileflow_pod_targets(project)
	targets = project.targets.select do |target|
		target.is_a?(Xcodeproj::Project::Object::PBXNativeTarget) &&
			(target.name == 'TileflowReactNative' || target.name.start_with?('TileflowReactNative-', 'AppHost-TileflowReactNative-'))
	end
	raise 'TileflowReactNative pod target is missing' unless targets.any? { |target| target.name == 'TileflowReactNative' }
	targets
end

def tileflow_link_product(project, target, reference, name)
	products = target.package_product_dependencies.select { |product| product.product_name == name }
	if products.any? { |product| product.package != reference } || products.length > 1
		raise "Conflicting #{name} product on #{target.name}"
	end
	product = products.first
	unless product
		product = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
		product.package = reference
		product.product_name = name
		target.package_product_dependencies << product
	end
	phase = target.frameworks_build_phase
	unless phase.files.any? { |file| file.respond_to?(:product_ref) && file.product_ref == product }
		file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
		file.product_ref = product
		phase.files << file
	end
end
